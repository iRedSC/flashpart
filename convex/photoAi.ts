import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import { aiImageModel, upgradeAiImageModel } from "./photoAiConstants";
import { maybeUnarchiveGroupForActiveProduct } from "./groups";
import {
  applyApproveAiPhoto,
  applyMarkAiGenerating,
  getAiForOriginal,
  productHasPhotoRows,
} from "./productPhotos";
import { productErrorFields, needsRepublishPatch } from "./productState";
import { resolveAiImageSettings } from "./settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const photoAiModel = {
  processProductPhoto: makeFunctionReference(
    "photoAiProcess.js:processProductPhoto",
  ) as any,
};

export const processingPayload = internalQuery({
  args: {
    productId: v.id("products"),
    originalPhotoId: v.optional(v.id("productPhotos")),
    isRegeneration: v.optional(v.boolean()),
    modelOverride: v.optional(aiImageModel),
  },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);

    if (!product) {
      return null;
    }

    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const aiSettings = resolveAiImageSettings(settings);
    const aiImageModelId = args.modelOverride
      ? args.modelOverride
      : args.isRegeneration && aiSettings.aiImageUpgradeModelOnRegen
        ? upgradeAiImageModel(aiSettings.aiImageModel)
        : aiSettings.aiImageModel;

    if (args.originalPhotoId) {
      const original = await ctx.db.get(args.originalPhotoId);

      if (
        !original ||
        original.productId !== args.productId ||
        original.kind !== "original"
      ) {
        return null;
      }

      if (!original.storageId && !original.url) {
        return null;
      }

      const existingAi = await getAiForOriginal(ctx, args.originalPhotoId!);

      return {
        mode: "convex" as const,
        aiImageEditStrength: aiSettings.aiImageEditStrength,
        aiImageModel: aiImageModelId,
        aiImagePrompt:
          existingAi?.aiPrompt ??
          product.aiImagePrompt ??
          aiSettings.aiImageDefaultPrompt,
        aiImageWhitenBackground: aiSettings.aiImageWhitenBackground,
        originalPhotoId: original._id,
        originalStorageId: original.storageId,
        originalUrl: original.url,
        productId: product._id,
        shopifyProductId: product.shopifyProductId,
        sku: product.sku,
      };
    }

    if (!product.shopifyFileUrl || !product.shopifyFileId) {
      return null;
    }

    return {
      mode: "shopify" as const,
      aiImageEditStrength: aiSettings.aiImageEditStrength,
      aiImageModel: aiImageModelId,
      aiImagePrompt:
        product.aiImagePrompt ?? aiSettings.aiImageDefaultPrompt,
      aiImageWhitenBackground: aiSettings.aiImageWhitenBackground,
      aiShopifyFileId: product.aiShopifyFileId,
      productId: product._id,
      shopifyFileUrl: product.shopifyFileUrl,
      shopifyProductId: product.shopifyProductId,
      sku: product.sku,
    };
  },
});

export const markGenerating = internalMutation({
  args: {
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    await ctx.db.patch(args.productId, {
      aiImageError: undefined,
      aiImageStatus: "generating",
      lastError: undefined,
      pendingOperation: "aiImageGenerating",
      updatedAt: now,
    });
  },
});

export const markReady = internalMutation({
  args: {
    aiShopifyFileId: v.string(),
    aiShopifyFileStatus: v.union(
      v.literal("uploaded"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    aiShopifyFileUrl: v.optional(v.string()),
    productId: v.id("products"),
    aiImageModel: v.optional(aiImageModel),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const product = await ctx.db.get(args.productId);

    await ctx.db.patch(args.productId, {
      aiImageError: undefined,
      aiImageModel: args.aiImageModel,
      aiImageStatus: "ready",
      aiShopifyFileId: args.aiShopifyFileId,
      aiShopifyFileStatus: args.aiShopifyFileStatus,
      aiShopifyFileUrl: args.aiShopifyFileUrl,
      needsPhotoReview: true,
      pendingOperation: undefined,
      updatedAt: now,
      ...(product ? needsRepublishPatch(product) : {}),
    });
  },
});

export const markFailed = internalMutation({
  args: {
    error: v.string(),
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const product = await ctx.db.get(args.productId);

    await ctx.db.patch(args.productId, {
      aiImageError: args.error,
      aiImageStatus: "failed",
      ...productErrorFields(
        {
          at: now,
          code: "aiImageGeneration",
          message: args.error,
          operation: "aiImageGenerating",
        },
        now,
      ),
    });
    await maybeUnarchiveGroupForActiveProduct(ctx, product?.groupId, now);
  },
});

export const scheduleProcessing = internalMutation({
  args: {
    productId: v.id("products"),
    resetPrompt: v.optional(v.boolean()),
    originalPhotoId: v.optional(v.id("productPhotos")),
  },
  handler: async (ctx, args) => {
    if (args.originalPhotoId) {
      const original = await ctx.db.get(args.originalPhotoId);

      if (
        !original ||
        original.productId !== args.productId ||
        original.kind !== "original"
      ) {
        return;
      }

      const { aiGeneration, previousShopifyFileIds } =
        await applyMarkAiGenerating(ctx, {
          productId: args.productId,
          originalPhotoId: args.originalPhotoId,
        });

      await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
        productId: args.productId,
        originalPhotoId: args.originalPhotoId,
        aiGeneration,
        previousShopifyFileIds:
          previousShopifyFileIds.length > 0
            ? previousShopifyFileIds
            : undefined,
      });
      return;
    }

    const product = await ctx.db.get(args.productId);

    if (!product?.shopifyFileId || !product.shopifyFileUrl) {
      return;
    }

    const now = Date.now();
    const patch: Record<string, unknown> = {
      aiImageError: undefined,
      aiImageStatus: "generating",
      lastError: undefined,
      needsPhotoReview: undefined,
      pendingOperation: "aiImageGenerating",
      updatedAt: now,
      ...needsRepublishPatch(product),
    };

    if (args.resetPrompt) {
      const settings = await ctx.db
        .query("appSettings")
        .withIndex("by_key", (q) => q.eq("key", "singleton"))
        .unique();
      patch.aiImagePrompt = resolveAiImageSettings(settings).aiImageDefaultPrompt;
      patch.aiShopifyFileId = undefined;
      patch.aiShopifyFileStatus = undefined;
      patch.aiShopifyFileUrl = undefined;
    }

    await ctx.db.patch(args.productId, patch);
    await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
      productId: args.productId,
      previousAiShopifyFileId: args.resetPrompt
        ? product.aiShopifyFileId
        : undefined,
    });
  },
});

export const regenerate = mutation({
  args: {
    productId: v.id("products"),
    prompt: v.string(),
    sessionToken: v.string(),
    originalPhotoId: v.optional(v.id("productPhotos")),
    model: v.optional(aiImageModel),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const product = await ctx.db.get(args.productId);
    const prompt = args.prompt.trim();

    if (!product) {
      throw new ConvexError("Product not found.");
    }

    if (!prompt) {
      throw new ConvexError("Enter a prompt before regenerating.");
    }

    if (args.originalPhotoId) {
      const original = await ctx.db.get(args.originalPhotoId);

      if (
        !original ||
        original.productId !== args.productId ||
        original.kind !== "original"
      ) {
        throw new ConvexError("Original photo not found.");
      }

      if (!original.storageId && !original.url) {
        throw new ConvexError("Capture a product photo before regenerating.");
      }

      const now = Date.now();
      // Clears shopifyFile* so promote cannot reuse a stale Shopify file after regen.
      const { aiGeneration, previousShopifyFileIds } =
        await applyMarkAiGenerating(ctx, {
          productId: args.productId,
          originalPhotoId: args.originalPhotoId,
          prompt,
        });

      await ctx.db.patch(args.productId, {
        aiImagePrompt: prompt,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
        productId: args.productId,
        originalPhotoId: args.originalPhotoId,
        aiGeneration,
        isRegeneration: true,
        modelOverride: args.model,
        previousShopifyFileIds:
          previousShopifyFileIds.length > 0
            ? previousShopifyFileIds
            : undefined,
      });
      return;
    }

    const photoRows = await ctx.db
      .query("productPhotos")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();

    if (photoRows.length > 0) {
      throw new ConvexError(
        "Specify originalPhotoId to regenerate AI for a multi-photo product.",
      );
    }

    if (!product.shopifyFileId || !product.shopifyFileUrl) {
      throw new ConvexError("Capture a product photo before regenerating.");
    }

    const now = Date.now();
    const previousAiShopifyFileId = product.aiShopifyFileId;

    await ctx.db.patch(args.productId, {
      aiImageError: undefined,
      aiImagePrompt: prompt,
      aiImageStatus: "generating",
      lastError: undefined,
      needsPhotoReview: undefined,
      pendingOperation: "aiImageGenerating",
      updatedAt: now,
      ...needsRepublishPatch(product),
    });
    await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
      previousAiShopifyFileId,
      productId: args.productId,
      isRegeneration: true,
      modelOverride: args.model,
    });
  },
});

export const regenerateForPhoto = mutation({
  args: {
    sessionToken: v.string(),
    originalPhotoId: v.id("productPhotos"),
    prompt: v.optional(v.string()),
    model: v.optional(aiImageModel),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const original = await ctx.db.get(args.originalPhotoId);

    if (!original || original.kind !== "original") {
      throw new ConvexError("Original photo not found.");
    }

    if (!original.storageId && !original.url) {
      throw new ConvexError("Capture a product photo before regenerating.");
    }

    const product = await ctx.db.get(original.productId);

    if (!product) {
      throw new ConvexError("Product not found.");
    }

    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const defaultPrompt = resolveAiImageSettings(settings).aiImageDefaultPrompt;
    const prompt = args.prompt?.trim() || product.aiImagePrompt || defaultPrompt;
    const now = Date.now();

    // Clears shopifyFile* so promote cannot reuse a stale Shopify file after regen.
    const { aiGeneration, previousShopifyFileIds } =
      await applyMarkAiGenerating(ctx, {
        productId: original.productId,
        originalPhotoId: args.originalPhotoId,
        prompt,
      });

    await ctx.db.patch(original.productId, {
      aiImagePrompt: prompt,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
      productId: original.productId,
      originalPhotoId: args.originalPhotoId,
      aiGeneration,
      isRegeneration: true,
      modelOverride: args.model,
      previousShopifyFileIds:
        previousShopifyFileIds.length > 0
          ? previousShopifyFileIds
          : undefined,
    });
  },
});

export const approveAiPhoto = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    await applyApproveAiPhoto(ctx, args.photoId);
  },
});

export const approvePhoto = mutation({
  args: {
    productId: v.id("products"),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const product = await ctx.db.get(args.productId);

    if (!product) {
      throw new ConvexError("Product not found.");
    }

    // Multi-photo products must approve per AI row via approveAiPhoto.
    if (await productHasPhotoRows(ctx, args.productId)) {
      throw new ConvexError(
        "Use approveAiPhoto for multi-photo products.",
      );
    }

    if (product.aiImageStatus !== "ready") {
      throw new ConvexError("Approve the AI photo after generation finishes.");
    }

    await ctx.db.patch(args.productId, {
      needsPhotoReview: undefined,
      updatedAt: Date.now(),
    });
  },
});
