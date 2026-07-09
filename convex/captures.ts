import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { mutation } from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import { productHasPhotoRows } from "./productPhotos";
import { resolveAiImageSettings } from "./settings";
import { shopifyFileStatus } from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const photoAiModel = {
  processProductPhoto: makeFunctionReference(
    "photoAi.js:processProductPhoto",
  ) as any,
};

export const record = mutation({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
    groupId: v.id("groups"),
    shopifyFileId: v.optional(v.string()),
    shopifyFileStatus: v.optional(shopifyFileStatus),
    shopifyFileUrl: v.optional(v.string()),
    shopifyStagedResourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    // Multi-photo products must not mix in the legacy Shopify capture path.
    if (await productHasPhotoRows(ctx, args.productId)) {
      throw new Error(
        "This product already has Convex photo rows. Use the multi-photo capture flow instead of the legacy Shopify capture path.",
      );
    }

    const now = Date.now();
    const existingProduct = await ctx.db.get(args.productId);
    const previousAiShopifyFileId = existingProduct?.aiShopifyFileId;
    const captureStatus =
      args.shopifyFileStatus === "ready" ? "ready" : "recorded";
    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const { aiImageDefaultPrompt } = resolveAiImageSettings(settings);
    const captureId = await ctx.db.insert("captures", {
      productId: args.productId,
      groupId: args.groupId,
      shopifyFileId: args.shopifyFileId,
      shopifyFileStatus: args.shopifyFileStatus,
      shopifyFileUrl: args.shopifyFileUrl,
      shopifyStagedResourceUrl: args.shopifyStagedResourceUrl,
      status: captureStatus,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.productId, {
      aiImageError: undefined,
      aiImagePrompt: aiImageDefaultPrompt,
      aiImageStatus: args.shopifyFileId ? "generating" : undefined,
      aiShopifyFileId: undefined,
      aiShopifyFileStatus: undefined,
      aiShopifyFileUrl: undefined,
      captureId,
      lastError: undefined,
      needsPhotoReview: undefined,
      pendingOperation: args.shopifyFileId ? "aiImageGenerating" : undefined,
      phase: "captured",
      shopifyFileId: args.shopifyFileId,
      shopifyFileStatus: args.shopifyFileStatus,
      shopifyFileUrl: args.shopifyFileUrl,
      shopifyStagedResourceUrl: args.shopifyStagedResourceUrl,
      updatedAt: now,
    });

    // Legacy Shopify captures only — Convex uploads use recordConvexCapture +
    // productPhotos.createOriginalFromUpload (B2 schedules AI per originalPhotoId).
    if (args.shopifyFileId && args.shopifyFileUrl) {
      await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
        previousAiShopifyFileId,
        productId: args.productId,
      });
    }

    return captureId;
  },
});

/** Capture row for Convex storage uploads (no Shopify file fields / no legacy AI). */
export const recordConvexCapture = mutation({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const product = await ctx.db.get(args.productId);

    if (!product) {
      throw new Error("Product not found");
    }

    const now = Date.now();
    const captureId = await ctx.db.insert("captures", {
      productId: args.productId,
      groupId: args.groupId,
      status: "recorded",
      createdAt: now,
      updatedAt: now,
    });

    // Do not set phase "captured" here — that would mark the product captured
    // before any original photo rows exist (skip-without-photo bug).
    // syncProductPhotoFlags sets phase once originals are present.
    await ctx.db.patch(args.productId, {
      captureId,
      lastError: undefined,
      updatedAt: now,
    });

    return captureId;
  },
});

export const markProcessing = mutation({
  args: {
    sessionToken: v.string(),
    captureId: v.id("captures"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const capture = await ctx.db.get(args.captureId);

    if (!capture) {
      throw new Error("Capture not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.captureId, {
      status: "fileProcessing",
      updatedAt: now,
    });
    await ctx.db.patch(capture.productId, {
      pendingOperation: "captureProcessing",
      updatedAt: now,
    });
  },
});

export const markProcessed = mutation({
  args: {
    sessionToken: v.string(),
    captureId: v.id("captures"),
    shopifyFileUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const capture = await ctx.db.get(args.captureId);

    if (!capture) {
      throw new Error("Capture not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.captureId, {
      shopifyFileStatus: "ready",
      shopifyFileUrl: args.shopifyFileUrl,
      status: "ready",
      updatedAt: now,
    });
    await ctx.db.patch(capture.productId, {
      needsPhotoReview: true,
      pendingOperation: undefined,
      phase: "captured",
      shopifyFileStatus: "ready",
      shopifyFileUrl: args.shopifyFileUrl,
      updatedAt: now,
    });
  },
});
