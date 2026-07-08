import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { mutation } from "./_generated/server";
import { requireSessionUser } from "./authUtils";
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

    if (args.shopifyFileId && args.shopifyFileUrl) {
      await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
        previousAiShopifyFileId,
        productId: args.productId,
      });
    }

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
