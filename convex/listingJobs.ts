import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
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
  findProductBySku,
  skuToShopifyHandle,
  updateShopifyProduct,
  updateShopifyVariant,
} from "./shopifyClient";

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
    let queued = 0;

    for (const productId of args.productIds) {
      const product = await ctx.db.get(productId);

      if (!product || product.shopifyProductId) {
        continue;
      }

      if (!product.shopifyFileId) {
        await ctx.db.patch(productId, {
          error: "Capture a Shopify-hosted photo before publishing.",
          status: "failed",
          updatedAt: now,
        });
        continue;
      }

      const jobId = await ctx.db.insert("listingJobs", {
        productId,
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
      await ctx.db.patch(productId, {
        error: undefined,
        status: "processing",
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

    return {
      connection,
      job,
      product,
      settings: {
        duplicatePolicy: settings?.duplicatePolicy ?? "blockExisting",
        shopifyPublishTarget: settings?.shopifyPublishTarget ?? "draft",
      },
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

    const now = Date.now();

    await ctx.db.patch(args.jobId, {
      completedAt: now,
      result: args.result,
      status: "succeeded",
      updatedAt: now,
    });
    await ctx.db.patch(job.productId, {
      error: undefined,
      shopifyProductHandle: args.shopifyProductHandle,
      shopifyProductId: args.shopifyProductId,
      shopifyStatus: args.shopifyStatus,
      shopifyVariantId: args.shopifyVariantId,
      status: args.shopifyStatus === "published" ? "published" : "draftCreated",
      updatedAt: now,
    });
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
    await ctx.db.patch(job.productId, {
      error: message,
      status: "blockedExistingSku",
      updatedAt: now,
    });
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

    await ctx.db.patch(args.jobId, {
      completedAt: now,
      error: args.error,
      status: "failed",
      updatedAt: now,
    });
    await ctx.db.patch(job.productId, {
      error: args.error,
      status: "failed",
      updatedAt: now,
    });
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

      if (!payload.product.shopifyFileId) {
        throw new Error("Capture a Shopify-hosted photo before publishing.");
      }

      const handle = skuToShopifyHandle(payload.product.sku);

      if (!handle) {
        throw new Error("SKU must contain letters or numbers to become a Shopify handle.");
      }

      const existing = await findProductBySku(
        payload.connection,
        payload.product.sku,
      );

      if (existing && payload.product.duplicatePolicy === "blockExisting") {
        await ctx.runMutation(listingJobModel.markJobBlockedExistingSku, {
          existingShopifyProductId: existing.productId,
          jobId: args.jobId,
        });
        return;
      }

      const publishTarget = payload.settings.shopifyPublishTarget;
      const shopifyStatus =
        publishTarget === "published" ? ("published" as const) : ("draft" as const);
      let shopifyProductId: string;
      let shopifyVariantId: string | undefined;
      let mode: "created" | "updated";

      if (existing) {
        const product = await updateShopifyProduct(payload.connection, {
          handle,
          productId: existing.productId,
          publishTarget,
          title: payload.product.name,
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
        const product = await createShopifyProduct(payload.connection, {
          handle,
          publishTarget,
          title: payload.product.name,
        });
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

      await addFileReferenceToProduct(payload.connection, {
        fileId: payload.product.shopifyFileId,
        productId: shopifyProductId,
      });

      await ctx.runMutation(listingJobModel.markJobSucceeded, {
        jobId: args.jobId,
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
      await ctx.db.patch(job.productId, {
        shopifyProductId: args.shopifyProductId,
        shopifyStatus: "draft",
        status: "draftCreated",
        updatedAt: now,
      });
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

    await ctx.db.patch(args.jobId, {
      status: "failed",
      error: args.error,
      updatedAt: now,
    });
    await ctx.db.patch(job.productId, {
      status: "failed",
      error: args.error,
      updatedAt: now,
    });
  },
});
