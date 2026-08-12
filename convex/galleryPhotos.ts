import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import { aiImageModel, upgradeAiImageModel } from "./photoAiConstants";
import {
  DEFAULT_GALLERY_OWNER_ID,
  galleryPhotoOwnership,
  isGalleryPhoto,
} from "./photoOwnership";
import {
  applyApproveAiPhoto,
  applyDeletePhoto,
  applyMarkAiGeneratingFromOriginal,
  getAiForOriginal,
} from "./productPhotos";
import { resolveAiImageSettings } from "./settings";

type DbCtx = QueryCtx | MutationCtx;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processGalleryPhotoRef = makeFunctionReference(
  "photoAiProcess.js:processGalleryPhoto",
) as any;

function compareNewestFirst(
  left: { createdAt: number; sortOrder: number },
  right: { createdAt: number; sortOrder: number },
) {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }

  return right.sortOrder - left.sortOrder;
}

async function listGalleryOriginals(ctx: DbCtx, ownerId: string) {
  const photos = await ctx.db
    .query("productPhotos")
    .withIndex("by_owner_kind", (q) =>
      q
        .eq("ownerType", "gallery")
        .eq("ownerId", ownerId)
        .eq("kind", "original"),
    )
    .collect();

  return photos.sort(compareNewestFirst);
}

async function assertStorageIdAvailable(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
) {
  const existing = await ctx.db
    .query("productPhotos")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();

  if (existing) {
    throw new ConvexError(
      "This upload is already attached to another photo.",
    );
  }
}

async function assertGalleryOriginal(
  ctx: DbCtx,
  photoId: Id<"productPhotos">,
): Promise<Doc<"productPhotos">> {
  const photo = await ctx.db.get(photoId);

  if (!photo || !isGalleryPhoto(photo) || photo.kind !== "original") {
    throw new ConvexError("Gallery photo not found.");
  }

  return photo;
}

/** Gallery originals with paired AI rows for the Photos page. */
export const listPairs = query({
  args: {
    sessionToken: v.string(),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const ownerId = args.ownerId ?? DEFAULT_GALLERY_OWNER_ID;
    const originals = await listGalleryOriginals(ctx, ownerId);

    return await Promise.all(
      originals.map(async (original) => ({
        original,
        ai: await getAiForOriginal(ctx, original._id),
      })),
    );
  },
});

/** @deprecated Prefer listPairs — kept for older clients. */
export const list = query({
  args: {
    sessionToken: v.string(),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const ownerId = args.ownerId ?? DEFAULT_GALLERY_OWNER_ID;
    return await listGalleryOriginals(ctx, ownerId);
  },
});

export const getPair = query({
  args: {
    sessionToken: v.string(),
    originalPhotoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const original = await assertGalleryOriginal(ctx, args.originalPhotoId);
    return {
      original,
      ai: await getAiForOriginal(ctx, original._id),
    };
  },
});

/**
 * Attach an uploaded Convex blob as a gallery original and schedule AI edit.
 */
export const createFromUpload = mutation({
  args: {
    sessionToken: v.string(),
    storageId: v.id("_storage"),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    await assertStorageIdAvailable(ctx, args.storageId);

    const ownerId = args.ownerId ?? DEFAULT_GALLERY_OWNER_ID;
    const ownership = galleryPhotoOwnership(ownerId);
    const existing = await listGalleryOriginals(ctx, ownerId);
    const maxSortOrder = existing.reduce(
      (max, photo) => Math.max(max, photo.sortOrder),
      -1,
    );
    const now = Date.now();
    const url = await ctx.storage.getUrl(args.storageId);

    const originalPhotoId = await ctx.db.insert("productPhotos", {
      ...ownership,
      kind: "original",
      storageId: args.storageId,
      url: url ?? undefined,
      status: "ready",
      sortOrder: maxSortOrder + 1,
      createdAt: now,
      updatedAt: now,
    });

    const { aiGeneration, previousShopifyFileIds } =
      await applyMarkAiGeneratingFromOriginal(ctx, {
        originalPhotoId,
      });

    await ctx.scheduler.runAfter(0, processGalleryPhotoRef, {
      originalPhotoId,
      aiGeneration,
      previousShopifyFileIds:
        previousShopifyFileIds.length > 0 ? previousShopifyFileIds : undefined,
    });

    return originalPhotoId;
  },
});

/** Regenerate AI for a gallery original (optional prompt / model). */
export const regenerate = mutation({
  args: {
    sessionToken: v.string(),
    originalPhotoId: v.id("productPhotos"),
    prompt: v.optional(v.string()),
    model: v.optional(aiImageModel),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const original = await assertGalleryOriginal(ctx, args.originalPhotoId);

    if (!original.storageId && !original.url) {
      throw new ConvexError("Capture a photo before editing.");
    }

    const { aiGeneration, previousShopifyFileIds } =
      await applyMarkAiGeneratingFromOriginal(ctx, {
        originalPhotoId: args.originalPhotoId,
        prompt: args.prompt,
      });

    await ctx.scheduler.runAfter(0, processGalleryPhotoRef, {
      originalPhotoId: args.originalPhotoId,
      aiGeneration,
      isRegeneration: true,
      modelOverride: args.model,
      previousShopifyFileIds:
        previousShopifyFileIds.length > 0 ? previousShopifyFileIds : undefined,
    });

    return null;
  },
});

export const approveAiPhoto = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const photo = await ctx.db.get(args.photoId);

    if (!photo || !isGalleryPhoto(photo) || photo.kind !== "ai") {
      throw new ConvexError("Gallery edited photo not found.");
    }

    await applyApproveAiPhoto(ctx, args.photoId);
    return null;
  },
});

/** Delete a gallery original (+ AI child). Rejects if Shopify files still attached. */
export const deletePhoto = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const photo = await ctx.db.get(args.photoId);

    if (!photo || !isGalleryPhoto(photo)) {
      throw new ConvexError("Gallery photo not found.");
    }

    if (photo.shopifyFileId) {
      throw new ConvexError(
        "This photo is on Shopify. Use Remove from Shopify first.",
      );
    }

    if (photo.kind === "original") {
      const aiChild = await getAiForOriginal(ctx, photo._id);
      if (aiChild?.shopifyFileId) {
        throw new ConvexError(
          "The edited photo is on Shopify. Use Remove from Shopify first.",
        );
      }
    }

    await applyDeletePhoto(ctx, args.photoId);
    return null;
  },
});

export const processingPayload = internalQuery({
  args: {
    originalPhotoId: v.id("productPhotos"),
    isRegeneration: v.optional(v.boolean()),
    modelOverride: v.optional(aiImageModel),
  },
  handler: async (ctx, args) => {
    const original = await ctx.db.get(args.originalPhotoId);

    if (
      !original ||
      !isGalleryPhoto(original) ||
      original.kind !== "original"
    ) {
      return null;
    }

    if (!original.storageId && !original.url) {
      return null;
    }

    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const aiSettings = resolveAiImageSettings(settings);
    const existingAi = await getAiForOriginal(ctx, args.originalPhotoId);
    const aiImageModelId = args.modelOverride
      ? args.modelOverride
      : args.isRegeneration && aiSettings.aiImageUpgradeModelOnRegen
        ? upgradeAiImageModel(aiSettings.aiImageModel)
        : aiSettings.aiImageModel;

    return {
      aiImageEditStrength: aiSettings.aiImageEditStrength,
      aiImageModel: aiImageModelId,
      aiImagePrompt:
        existingAi?.aiPrompt ?? aiSettings.aiImageDefaultPrompt,
      aiImageWhitenBackground: aiSettings.aiImageWhitenBackground,
      filenameHint: `gallery-${String(original._id).slice(-8)}`,
      originalPhotoId: original._id,
      originalStorageId: original.storageId,
      originalUrl: original.url,
    };
  },
});

export const clearShopifyIdentity = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const photo = await ctx.db.get(args.photoId);

    if (!photo || !isGalleryPhoto(photo)) {
      throw new ConvexError("Gallery photo not found.");
    }

    const now = Date.now();
    await ctx.db.patch(args.photoId, {
      shopifyFileDeletedAt: now,
      shopifyFileId: undefined,
      shopifyFileStatus: undefined,
      status:
        photo.kind === "ai" && photo.aiStatus === "ready"
          ? "ready"
          : photo.status === "promoted"
            ? "ready"
            : photo.status,
      updatedAt: now,
    });

    return null;
  },
});

export const markAiGeneratingInternal = internalMutation({
  args: {
    originalPhotoId: v.id("productPhotos"),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await applyMarkAiGeneratingFromOriginal(ctx, args);
  },
});
