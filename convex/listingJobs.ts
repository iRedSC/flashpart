import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import {
  addFileReferenceToProduct,
  createShopifyProduct,
  createShopifyVariant,
  deleteShopifyFiles,
  findProductBySku,
  skuToShopifyHandle,
  updateShopifyProduct,
  updateShopifyVariant,
} from "./shopifyClient";
import {
  maybeAutoArchiveGroup,
  maybeUnarchiveGroupForActiveProduct,
} from "./groups";
import { productErrorFields } from "./productState";
import {
  evaluateProductPhotosPublishGate,
  productHasPhotoRows,
} from "./productPhotos";
import { getSettingsDocument } from "./settings";
import { mergeTagLists } from "./tags";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const listingJobModel = {
  jobPayload: makeFunctionReference("listingJobs.js:jobPayload") as any,
  markJobBlockedExistingSku: makeFunctionReference(
    "listingJobs.js:markJobBlockedExistingSku",
  ) as any,
  markJobFailed: makeFunctionReference("listingJobs.js:markJobFailed") as any,
  markJobRunning: makeFunctionReference("listingJobs.js:markJobRunning") as any,
  markJobSucceeded: makeFunctionReference(
    "listingJobs.js:markJobSucceeded",
  ) as any,
  processQueuedJob: makeFunctionReference(
    "listingJobs.js:processQueuedJob",
  ) as any,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const promotePhotoInternal = makeFunctionReference(
  "shopify.js:promotePhotoInternal",
) as any;

export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await ctx.db.query("listingJobs").order("desc").collect();
  },
});

export const enqueueCreateDrafts = mutation({
  args: {
    sessionToken: v.string(),
    productIds: v.array(v.id("products")),
  },
  handler: async (ctx, args) => {
    const userId = await requireSessionUser(ctx, args.sessionToken);
    const connections = await ctx.db
      .query("shopifyConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const connection = connections
      .filter((item) => item.isActive)
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .at(0);

    if (!connection) {
      throw new Error("Connect Shopify before publishing products.");
    }

    const now = Date.now();
    const products = [];
    const missingCaptureProducts = [];
    const aiNotReadyProducts = [];
    const needsReviewProducts = [];

    for (const productId of args.productIds) {
      const product = await ctx.db.get(productId);

      if (!product || product.shopifyProductId) {
        continue;
      }

      if (await productHasPhotoRows(ctx, productId)) {
        const gate = await evaluateProductPhotosPublishGate(ctx, productId);

        if (!gate.ok) {
          if (gate.reason === "missingOriginal") {
            missingCaptureProducts.push(product);
          } else if (
            gate.reason === "aiGenerating" ||
            gate.reason === "aiMissing"
          ) {
            aiNotReadyProducts.push(product);
          } else {
            needsReviewProducts.push(product);
          }
          continue;
        }

        products.push(product);
        continue;
      }

      if (!product.shopifyFileId) {
        missingCaptureProducts.push(product);
        continue;
      }

      if (
        product.aiImageStatus !== "ready" ||
        !product.aiShopifyFileId
      ) {
        aiNotReadyProducts.push(product);
        continue;
      }

      if (product.needsPhotoReview) {
        needsReviewProducts.push(product);
        continue;
      }

      products.push(product);
    }

    if (missingCaptureProducts.length > 0) {
      throw new Error(
        missingCaptureProducts.length === 1
          ? `Capture a Shopify-hosted photo before publishing ${missingCaptureProducts[0].sku}.`
          : `Capture Shopify-hosted photos for ${missingCaptureProducts.length.toLocaleString()} products before publishing.`,
      );
    }

    if (aiNotReadyProducts.length > 0) {
      throw new Error(
        aiNotReadyProducts.length === 1
          ? `Wait for the AI photo to finish generating for ${aiNotReadyProducts[0].sku} before publishing.`
          : `Wait for AI photos to finish generating for ${aiNotReadyProducts.length.toLocaleString()} products before publishing.`,
      );
    }

    if (needsReviewProducts.length > 0) {
      throw new Error(
        needsReviewProducts.length === 1
          ? `Review and approve the AI photo for ${needsReviewProducts[0].sku} before publishing.`
          : `Review and approve AI photos for ${needsReviewProducts.length.toLocaleString()} products before publishing.`,
      );
    }

    let queued = 0;

    for (const product of products) {
      const jobId = await ctx.db.insert("listingJobs", {
        productId: product._id,
        userId,
        shopifyConnectionId: connection._id,
        groupId: product.groupId,
        captureId: product.captureId,
        type: "createShopifyDraft",
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(product._id, {
        lastError: undefined,
        pendingOperation: "publishing",
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, listingJobModel.processQueuedJob, {
        jobId,
      });
      queued += 1;
    }

    return { queued };
  },
});

export const jobPayload = internalQuery({
  args: {
    jobId: v.id("listingJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      return null;
    }

    const product = await ctx.db.get(job.productId);
    const connection = job.shopifyConnectionId
      ? await ctx.db.get(job.shopifyConnectionId)
      : null;
    const settings =
      (await ctx.db
        .query("appSettings")
        .withIndex("by_key", (q) => q.eq("key", "singleton"))
        .unique()) ?? null;

    const useProductPhotos = product
      ? await productHasPhotoRows(ctx, product._id)
      : false;
    let approvedAiPhotoIds: Id<"productPhotos">[] = [];

    if (product && useProductPhotos) {
      const gate = await evaluateProductPhotosPublishGate(ctx, product._id);
      if (gate.ok) {
        approvedAiPhotoIds = gate.approvedAiPhotos.map((photo) => photo._id);
      }
    }

    return {
      connection,
      job,
      product,
      settings: {
        duplicatePolicy: settings?.duplicatePolicy ?? "blockExisting",
        shopifyDefaultTags: settings?.shopifyDefaultTags,
        shopifyProductType: settings?.shopifyProductType ?? "Part",
        shopifyPublishTarget: settings?.shopifyPublishTarget ?? "draft",
      },
      useProductPhotos,
      approvedAiPhotoIds,
    };
  },
});

export const markJobRunning = internalMutation({
  args: {
    jobId: v.id("listingJobs"),
    triggerRunId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Listing job not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.jobId, {
      attempts: job.attempts + 1,
      startedAt: job.startedAt ?? now,
      status: "running",
      triggerRunId: args.triggerRunId,
      updatedAt: now,
    });
  },
});

export const markJobSucceeded = internalMutation({
  args: {
    jobId: v.id("listingJobs"),
    originalShopifyFileId: v.optional(v.string()),
    publishFileId: v.optional(v.string()),
    publishFileIds: v.optional(v.array(v.string())),
    result: v.any(),
    shopifyProductHandle: v.string(),
    shopifyProductId: v.string(),
    shopifyStatus: v.union(v.literal("draft"), v.literal("published")),
    shopifyVariantId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Listing job not found");
    }

    const product = await ctx.db.get(job.productId);
    const now = Date.now();

    await ctx.db.patch(args.jobId, {
      completedAt: now,
      result: args.result,
      status: "succeeded",
      updatedAt: now,
    });

    const settings = await getSettingsDocument(ctx);
    const shouldAutoArchive = settings?.autoArchiveComplete === true;

    // Multi-photo path: attach promoted AI file IDs in result only; keep product
    // photo rows / original Convex storage; clear review flag without rewriting
    // legacy single-file product fields.
    if (args.publishFileIds !== undefined) {
      await ctx.db.patch(job.productId, {
        archivedAt: shouldAutoArchive ? now : product?.archivedAt,
        lastError: undefined,
        needsPhotoReview: undefined,
        pendingOperation: undefined,
        phase: "published",
        shopifyProductHandle: args.shopifyProductHandle,
        shopifyProductId: args.shopifyProductId,
        shopifyStatus: args.shopifyStatus,
        shopifyVariantId: args.shopifyVariantId,
        updatedAt: now,
      });

      if (shouldAutoArchive) {
        await maybeAutoArchiveGroup(ctx, product?.groupId, now);
      }
      return;
    }

    const publishedFileId = args.publishFileId ?? product?.aiShopifyFileId;
    const publishedFileUrl = product?.aiShopifyFileUrl;
    const publishedFileStatus = product?.aiShopifyFileStatus;

    await ctx.db.patch(job.productId, {
      aiImageError: undefined,
      aiImagePrompt: undefined,
      aiImageStatus: undefined,
      aiShopifyFileId: undefined,
      aiShopifyFileStatus: undefined,
      aiShopifyFileUrl: undefined,
      archivedAt: shouldAutoArchive ? now : product?.archivedAt,
      lastError: undefined,
      needsPhotoReview: undefined,
      pendingOperation: undefined,
      phase: "published",
      shopifyFileDeletedAt:
        args.originalShopifyFileId &&
        args.originalShopifyFileId !== publishedFileId
          ? now
          : product?.shopifyFileDeletedAt,
      shopifyFileId: publishedFileId,
      shopifyFileStatus: publishedFileStatus,
      shopifyFileUrl: publishedFileUrl,
      shopifyProductHandle: args.shopifyProductHandle,
      shopifyProductId: args.shopifyProductId,
      shopifyStatus: args.shopifyStatus,
      shopifyVariantId: args.shopifyVariantId,
      updatedAt: now,
    });

    if (shouldAutoArchive) {
      await maybeAutoArchiveGroup(ctx, product?.groupId, now);
    }
  },
});

export const markJobBlockedExistingSku = internalMutation({
  args: {
    jobId: v.id("listingJobs"),
    existingShopifyProductId: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Listing job not found");
    }

    const now = Date.now();
    const message = "A Shopify product with this SKU already exists.";

    await ctx.db.patch(args.jobId, {
      completedAt: now,
      error: message,
      result: {
        existingShopifyProductId: args.existingShopifyProductId,
      },
      status: "failed",
      updatedAt: now,
    });
    const product = await ctx.db.get(job.productId);

    await ctx.db.patch(
      job.productId,
      productErrorFields(
        {
          code: "duplicateSku",
          message,
          operation: "publishing",
          at: now,
        },
        now,
      ),
    );
    await maybeUnarchiveGroupForActiveProduct(ctx, product?.groupId, now);
  },
});

export const markJobFailed = internalMutation({
  args: {
    jobId: v.id("listingJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Listing job not found");
    }

    const now = Date.now();
    const product = await ctx.db.get(job.productId);

    await ctx.db.patch(args.jobId, {
      completedAt: now,
      error: args.error,
      status: "failed",
      updatedAt: now,
    });
    await ctx.db.patch(
      job.productId,
      productErrorFields(
        {
          code: "shopifyApi",
          message: args.error,
          operation: "publishing",
          at: now,
        },
        now,
      ),
    );
    await maybeUnarchiveGroupForActiveProduct(ctx, product?.groupId, now);
  },
});

export const processQueuedJob = internalAction({
  args: {
    jobId: v.id("listingJobs"),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(listingJobModel.markJobRunning, {
      jobId: args.jobId,
    });

    try {
      const payload = await ctx.runQuery(listingJobModel.jobPayload, {
        jobId: args.jobId,
      });

      if (!payload?.job || !payload.product || !payload.connection) {
        throw new Error("Listing job is missing product or Shopify connection data.");
      }

      if (payload.job.type !== "createShopifyDraft") {
        throw new Error(`Unsupported listing job type: ${payload.job.type}.`);
      }

      const useProductPhotos = payload.useProductPhotos === true;
      let publishFileIds: string[] | undefined;
      let originalShopifyFileId: string | undefined;
      let publishFileId: string | undefined;

      if (useProductPhotos) {
        const approvedAiPhotoIds =
          (payload.approvedAiPhotoIds as Id<"productPhotos">[] | undefined) ??
          [];

        if (approvedAiPhotoIds.length < 1) {
          throw new Error(
            "Approve at least one AI photo before publishing.",
          );
        }

        publishFileIds = [];
        for (const photoId of approvedAiPhotoIds) {
          const promoted = (await ctx.runAction(promotePhotoInternal, {
            photoId,
          })) as { shopifyFileId: string };

          if (!promoted?.shopifyFileId) {
            throw new Error("Failed to promote an AI photo to Shopify.");
          }

          publishFileIds.push(promoted.shopifyFileId);
        }
      } else {
        if (!payload.product.aiShopifyFileId) {
          throw new Error("Generate an AI photo before publishing.");
        }

        originalShopifyFileId = payload.product.shopifyFileId;
        publishFileId = payload.product.aiShopifyFileId;

        if (!originalShopifyFileId) {
          throw new Error("Capture a Shopify-hosted photo before publishing.");
        }
      }

      const handle = skuToShopifyHandle(payload.product.sku);

      if (!handle) {
        throw new Error("SKU must contain letters or numbers to become a Shopify handle.");
      }

      const existing = await findProductBySku(
        payload.connection,
        payload.product.sku,
      );

      if (existing && payload.settings.duplicatePolicy === "blockExisting") {
        await ctx.runMutation(listingJobModel.markJobBlockedExistingSku, {
          existingShopifyProductId: existing.productId,
          jobId: args.jobId,
        });
        return;
      }

      const publishTarget = payload.settings.shopifyPublishTarget;
      const shopifyStatus =
        publishTarget === "published" ? ("published" as const) : ("draft" as const);
      const productType = payload.settings.shopifyProductType.trim() || "Part";
      const tags = mergeTagLists(
        payload.settings.shopifyDefaultTags,
        payload.product.tags,
      );
      const vendor = payload.product.vendor?.trim() || undefined;
      const shopifyListing = {
        handle,
        productType,
        publishTarget,
        tags,
        title: payload.product.name,
        vendor,
      };
      let shopifyProductId: string;
      let shopifyVariantId: string | undefined;
      let mode: "created" | "updated";

      if (existing) {
        const product = await updateShopifyProduct(payload.connection, {
          ...shopifyListing,
          productId: existing.productId,
        });
        shopifyProductId = product.id;
        shopifyVariantId = existing.variantId
          ? (
              await updateShopifyVariant(payload.connection, {
                barcode: payload.product.sku,
                price: payload.product.price,
                productId: product.id,
                sku: payload.product.sku,
                variantId: existing.variantId,
              })
            ).id
          : undefined;
        mode = "updated";
      } else {
        const product = await createShopifyProduct(payload.connection, shopifyListing);
        const variant = await createShopifyVariant(payload.connection, {
          barcode: payload.product.sku,
          price: payload.product.price,
          productId: product.id,
          sku: payload.product.sku,
        });
        shopifyProductId = product.id;
        shopifyVariantId = variant.id;
        mode = "created";
      }

      if (useProductPhotos && publishFileIds) {
        for (const fileId of publishFileIds) {
          await addFileReferenceToProduct(payload.connection, {
            fileId,
            productId: shopifyProductId,
          });
        }

        await ctx.runMutation(listingJobModel.markJobSucceeded, {
          jobId: args.jobId,
          publishFileIds,
          result: {
            barcode: payload.product.sku,
            handle,
            mode,
            publishFileIds,
            publishTarget,
          },
          shopifyProductHandle: handle,
          shopifyProductId,
          shopifyStatus,
          shopifyVariantId,
        });
        return;
      }

      await addFileReferenceToProduct(payload.connection, {
        fileId: publishFileId!,
        productId: shopifyProductId,
      });

      if (originalShopifyFileId !== publishFileId) {
        await deleteShopifyFiles(payload.connection, [originalShopifyFileId!]);
      }

      await ctx.runMutation(listingJobModel.markJobSucceeded, {
        jobId: args.jobId,
        originalShopifyFileId,
        publishFileId,
        result: {
          barcode: payload.product.sku,
          handle,
          mode,
          publishTarget,
        },
        shopifyProductHandle: handle,
        shopifyProductId,
        shopifyStatus,
        shopifyVariantId,
      });
    } catch (error) {
      await ctx.runMutation(listingJobModel.markJobFailed, {
        error: error instanceof Error ? error.message : "Shopify listing job failed.",
        jobId: args.jobId,
      });
    }
  },
});

export const markRunning = mutation({
  args: {
    sessionToken: v.string(),
    jobId: v.id("listingJobs"),
    triggerRunId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Listing job not found");
    }

    await ctx.db.patch(args.jobId, {
      status: "running",
      attempts: job.attempts + 1,
      triggerRunId: args.triggerRunId,
      updatedAt: Date.now(),
    });
  },
});

export const markSucceeded = mutation({
  args: {
    sessionToken: v.string(),
    jobId: v.id("listingJobs"),
    shopifyProductId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Listing job not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.jobId, {
      status: "succeeded",
      updatedAt: now,
    });

    if (args.shopifyProductId) {
      const product = await ctx.db.get(job.productId);
      const settings = await getSettingsDocument(ctx);
      const shouldAutoArchive = settings?.autoArchiveComplete === true;

      await ctx.db.patch(job.productId, {
        archivedAt: shouldAutoArchive ? now : product?.archivedAt,
        lastError: undefined,
        pendingOperation: undefined,
        phase: "published",
        shopifyProductId: args.shopifyProductId,
        shopifyStatus: "draft",
        updatedAt: now,
      });

      if (shouldAutoArchive) {
        await maybeAutoArchiveGroup(ctx, product?.groupId, now);
      }
    }
  },
});

export const markFailed = mutation({
  args: {
    sessionToken: v.string(),
    jobId: v.id("listingJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Listing job not found");
    }

    const now = Date.now();
    const product = await ctx.db.get(job.productId);

    await ctx.db.patch(args.jobId, {
      status: "failed",
      error: args.error,
      updatedAt: now,
    });
    await ctx.db.patch(
      job.productId,
      productErrorFields(
        {
          code: "shopifyApi",
          message: args.error,
          operation: "publishing",
          at: now,
        },
        now,
      ),
    );
    await maybeUnarchiveGroupForActiveProduct(ctx, product?.groupId, now);
  },
});
