import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import { photoKind, shopifyFileStatus } from "./schema";
import {
  getSettingsDocument,
  resolveMaxProductPhotos,
} from "./settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processProductPhotoRef = makeFunctionReference(
  "photoAi.js:processProductPhoto",
) as any;

type DbCtx = QueryCtx | MutationCtx;

function comparePhotoOrder(
  left: { sortOrder: number; createdAt: number },
  right: { sortOrder: number; createdAt: number },
) {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }

  return left.createdAt - right.createdAt;
}

export async function getOriginalPhotos(ctx: DbCtx, productId: Id<"products">) {
  const photos = await ctx.db
    .query("productPhotos")
    .withIndex("by_product_kind", (q) =>
      q.eq("productId", productId).eq("kind", "original"),
    )
    .collect();

  return photos.sort(comparePhotoOrder);
}

export async function getAiPhotos(ctx: DbCtx, productId: Id<"products">) {
  const photos = await ctx.db
    .query("productPhotos")
    .withIndex("by_product_kind", (q) =>
      q.eq("productId", productId).eq("kind", "ai"),
    )
    .collect();

  return photos.sort(comparePhotoOrder);
}

export async function getAiForOriginal(
  ctx: DbCtx,
  originalPhotoId: Id<"productPhotos">,
) {
  return await ctx.db
    .query("productPhotos")
    .withIndex("by_source", (q) => q.eq("sourcePhotoId", originalPhotoId))
    .unique();
}

export async function countOriginals(ctx: DbCtx, productId: Id<"products">) {
  const originals = await getOriginalPhotos(ctx, productId);
  return originals.length;
}

export async function productHasPhotoRows(
  ctx: DbCtx,
  productId: Id<"products">,
) {
  const photo = await ctx.db
    .query("productPhotos")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .first();

  return photo !== null;
}

async function listPhotosForProduct(ctx: DbCtx, productId: Id<"products">) {
  const photos = await ctx.db
    .query("productPhotos")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();

  return photos.sort(comparePhotoOrder);
}

async function hasGeneratingAi(ctx: DbCtx, productId: Id<"products">) {
  const aiPhotos = await getAiPhotos(ctx, productId);
  return aiPhotos.some((photo) => photo.aiStatus === "generating");
}

async function hasUnapprovedReadyAi(ctx: DbCtx, productId: Id<"products">) {
  const aiPhotos = await getAiPhotos(ctx, productId);
  return aiPhotos.some(
    (photo) => photo.aiStatus === "ready" && photo.approvedAt === undefined,
  );
}

async function recomputeProductPhotoFlags(
  ctx: MutationCtx,
  productId: Id<"products">,
  now: number,
  options?: {
    clearPendingIfIdle?: boolean;
  },
) {
  const product = await ctx.db.get(productId);

  if (!product) {
    return;
  }

  const generating = await hasGeneratingAi(ctx, productId);
  const needsReview = await hasUnapprovedReadyAi(ctx, productId);
  const patch: Partial<Doc<"products">> = {
    needsPhotoReview: needsReview ? true : undefined,
    updatedAt: now,
  };

  if (generating) {
    patch.pendingOperation = "aiImageGenerating";
  } else if (
    options?.clearPendingIfIdle &&
    product.pendingOperation === "aiImageGenerating"
  ) {
    patch.pendingOperation = undefined;
  }

  await ctx.db.patch(productId, patch);
}

async function deleteStorageBlob(
  ctx: MutationCtx,
  storageId: Id<"_storage"> | undefined,
) {
  if (!storageId) {
    return;
  }

  try {
    await ctx.storage.delete(storageId);
  } catch {
    // Storage may already be gone; ignore.
  }
}

async function resolveAiPhotoRow(
  ctx: MutationCtx,
  args: {
    aiPhotoId?: Id<"productPhotos">;
    originalPhotoId?: Id<"productPhotos">;
  },
) {
  if (args.aiPhotoId) {
    const photo = await ctx.db.get(args.aiPhotoId);

    if (!photo || photo.kind !== "ai") {
      throw new ConvexError("AI photo not found.");
    }

    return photo;
  }

  if (args.originalPhotoId) {
    const aiPhoto = await getAiForOriginal(ctx, args.originalPhotoId);

    if (!aiPhoto) {
      throw new ConvexError("AI photo not found for original.");
    }

    return aiPhoto;
  }

  throw new ConvexError("Provide aiPhotoId or originalPhotoId.");
}

export async function applyMarkAiGenerating(
  ctx: MutationCtx,
  args: {
    productId: Id<"products">;
    originalPhotoId: Id<"productPhotos">;
    prompt?: string;
  },
) {
  const product = await ctx.db.get(args.productId);

  if (!product) {
    throw new ConvexError("Product not found.");
  }

  const original = await ctx.db.get(args.originalPhotoId);

  if (
    !original ||
    original.productId !== args.productId ||
    original.kind !== "original"
  ) {
    throw new ConvexError("Original photo not found.");
  }

  const now = Date.now();
  const existingAi = await getAiForOriginal(ctx, args.originalPhotoId);
  const prompt = args.prompt?.trim();

  let aiPhotoId: Id<"productPhotos">;

  if (existingAi) {
    await ctx.db.patch(existingAi._id, {
      aiError: undefined,
      aiPrompt: prompt || existingAi.aiPrompt,
      aiStatus: "generating",
      approvedAt: undefined,
      sortOrder: original.sortOrder,
      status: "uploading",
      updatedAt: now,
    });
    aiPhotoId = existingAi._id;
  } else {
    aiPhotoId = await ctx.db.insert("productPhotos", {
      productId: args.productId,
      kind: "ai",
      status: "uploading",
      sortOrder: original.sortOrder,
      sourcePhotoId: args.originalPhotoId,
      aiStatus: "generating",
      aiPrompt: prompt || undefined,
      createdAt: now,
      updatedAt: now,
    });
  }

  await ctx.db.patch(args.productId, {
    needsPhotoReview: undefined,
    pendingOperation: "aiImageGenerating",
    updatedAt: now,
  });

  return aiPhotoId;
}

export async function applyMarkAiReady(
  ctx: MutationCtx,
  args: {
    storageId: Id<"_storage">;
    url?: string;
    aiPhotoId?: Id<"productPhotos">;
    originalPhotoId?: Id<"productPhotos">;
  },
) {
  const aiPhoto = await resolveAiPhotoRow(ctx, args);
  const now = Date.now();
  const url = args.url ?? (await ctx.storage.getUrl(args.storageId));

  await ctx.db.patch(aiPhoto._id, {
    aiError: undefined,
    aiStatus: "ready",
    approvedAt: undefined,
    storageId: args.storageId,
    status: "ready",
    url: url ?? undefined,
    updatedAt: now,
  });

  await recomputeProductPhotoFlags(ctx, aiPhoto.productId, now, {
    clearPendingIfIdle: true,
  });

  return aiPhoto._id;
}

export async function applyMarkAiFailed(
  ctx: MutationCtx,
  args: {
    error: string;
    aiPhotoId?: Id<"productPhotos">;
    originalPhotoId?: Id<"productPhotos">;
  },
) {
  const aiPhoto = await resolveAiPhotoRow(ctx, args);
  const now = Date.now();

  await ctx.db.patch(aiPhoto._id, {
    aiError: args.error,
    aiStatus: "failed",
    status: "failed",
    updatedAt: now,
  });

  await recomputeProductPhotoFlags(ctx, aiPhoto.productId, now, {
    clearPendingIfIdle: true,
  });

  return aiPhoto._id;
}

export async function applyApproveAiPhoto(
  ctx: MutationCtx,
  photoId: Id<"productPhotos">,
) {
  const photo = await ctx.db.get(photoId);

  if (!photo || photo.kind !== "ai") {
    throw new ConvexError("AI photo not found.");
  }

  if (photo.aiStatus !== "ready") {
    throw new ConvexError("Approve the AI photo after generation finishes.");
  }

  const now = Date.now();

  await ctx.db.patch(photoId, {
    approvedAt: now,
    updatedAt: now,
  });

  const stillNeedsReview = await hasUnapprovedReadyAi(ctx, photo.productId);

  await ctx.db.patch(photo.productId, {
    needsPhotoReview: stillNeedsReview ? true : undefined,
    updatedAt: now,
  });
}

export const listByProduct = query({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await listPhotosForProduct(ctx, args.productId);
  },
});

export const listByProductKind = query({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
    kind: photoKind,
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const photos = await ctx.db
      .query("productPhotos")
      .withIndex("by_product_kind", (q) =>
        q.eq("productId", args.productId).eq("kind", args.kind),
      )
      .collect();

    return photos.sort(comparePhotoOrder);
  },
});

export const generateUploadUrl = mutation({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await ctx.storage.generateUploadUrl();
  },
});

export const createOriginalFromUpload = mutation({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
    storageId: v.id("_storage"),
    captureId: v.optional(v.id("captures")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const product = await ctx.db.get(args.productId);

    if (!product) {
      throw new ConvexError("Product not found.");
    }

    const settings = await getSettingsDocument(ctx);
    const maxPhotos = resolveMaxProductPhotos(settings);
    const originals = await getOriginalPhotos(ctx, args.productId);

    if (originals.length >= maxPhotos) {
      throw new ConvexError(
        `This product already has the maximum of ${maxPhotos} photos.`,
      );
    }

    const maxSortOrder = originals.reduce(
      (max, photo) => Math.max(max, photo.sortOrder),
      -1,
    );
    const sortOrder = maxSortOrder + 1;
    const url = await ctx.storage.getUrl(args.storageId);
    const now = Date.now();

    const photoId = await ctx.db.insert("productPhotos", {
      productId: args.productId,
      kind: "original",
      storageId: args.storageId,
      url: url ?? undefined,
      status: "ready",
      sortOrder,
      captureId: args.captureId,
      createdAt: now,
      updatedAt: now,
    });

    const productPatch: Partial<Doc<"products">> = {
      lastError: undefined,
      updatedAt: now,
    };

    if (product.phase === "imported" || product.phase === undefined) {
      productPatch.phase = "captured";
    }

    if (args.captureId) {
      productPatch.captureId = args.captureId;
    }

    await ctx.db.patch(args.productId, productPatch);

    await ctx.scheduler.runAfter(0, processProductPhotoRef, {
      productId: args.productId,
      originalPhotoId: photoId,
    });

    return photoId;
  },
});

export const setSortOrder = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
    sortOrder: v.number(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const photo = await ctx.db.get(args.photoId);

    if (!photo) {
      throw new ConvexError("Photo not found.");
    }

    if (photo.kind !== "original") {
      throw new ConvexError("Only original photos can be reordered.");
    }

    const now = Date.now();

    await ctx.db.patch(args.photoId, {
      sortOrder: args.sortOrder,
      updatedAt: now,
    });

    const aiChild = await getAiForOriginal(ctx, args.photoId);

    if (aiChild) {
      await ctx.db.patch(aiChild._id, {
        sortOrder: args.sortOrder,
        updatedAt: now,
      });
    }

    await ctx.db.patch(photo.productId, { updatedAt: now });
  },
});

export const deletePhoto = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const photo = await ctx.db.get(args.photoId);

    if (!photo) {
      throw new ConvexError("Photo not found.");
    }

    const now = Date.now();
    const toDelete: Doc<"productPhotos">[] = [photo];

    if (photo.kind === "original") {
      const aiChild = await getAiForOriginal(ctx, photo._id);

      if (aiChild) {
        toDelete.push(aiChild);
      }
    }

    for (const row of toDelete) {
      await deleteStorageBlob(ctx, row.storageId);
      // STUB (C1): Shopify file deletion. If row.shopifyFileId is set, do not call
      // Shopify here — C1 will delete remote files (or soft-clear shopify fields /
      // mark shopifyFileDeletedAt). For now we only remove the Convex row.
      await ctx.db.delete(row._id);
    }

    // TODO(Wave E): fuller product needsPhotoReview / pendingOperation recalc.
    await recomputeProductPhotoFlags(ctx, photo.productId, now, {
      clearPendingIfIdle: true,
    });
  },
});

export const markAiGenerating = mutation({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
    originalPhotoId: v.id("productPhotos"),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await applyMarkAiGenerating(ctx, {
      productId: args.productId,
      originalPhotoId: args.originalPhotoId,
      prompt: args.prompt,
    });
  },
});

export const markAiReady = mutation({
  args: {
    sessionToken: v.string(),
    storageId: v.id("_storage"),
    url: v.optional(v.string()),
    aiPhotoId: v.optional(v.id("productPhotos")),
    originalPhotoId: v.optional(v.id("productPhotos")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await applyMarkAiReady(ctx, {
      storageId: args.storageId,
      url: args.url,
      aiPhotoId: args.aiPhotoId,
      originalPhotoId: args.originalPhotoId,
    });
  },
});

export const markAiFailed = mutation({
  args: {
    sessionToken: v.string(),
    error: v.string(),
    aiPhotoId: v.optional(v.id("productPhotos")),
    originalPhotoId: v.optional(v.id("productPhotos")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await applyMarkAiFailed(ctx, {
      error: args.error,
      aiPhotoId: args.aiPhotoId,
      originalPhotoId: args.originalPhotoId,
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

/** Internal variants for photoAi actions (no session). */
export const markAiGeneratingInternal = internalMutation({
  args: {
    productId: v.id("products"),
    originalPhotoId: v.id("productPhotos"),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await applyMarkAiGenerating(ctx, args);
  },
});

export const markAiReadyInternal = internalMutation({
  args: {
    storageId: v.id("_storage"),
    url: v.optional(v.string()),
    aiPhotoId: v.optional(v.id("productPhotos")),
    originalPhotoId: v.optional(v.id("productPhotos")),
  },
  handler: async (ctx, args) => {
    return await applyMarkAiReady(ctx, args);
  },
});

export const markAiFailedInternal = internalMutation({
  args: {
    error: v.string(),
    aiPhotoId: v.optional(v.id("productPhotos")),
    originalPhotoId: v.optional(v.id("productPhotos")),
  },
  handler: async (ctx, args) => {
    return await applyMarkAiFailed(ctx, args);
  },
});

export const markPromoted = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
    shopifyFileId: v.string(),
    shopifyFileStatus: shopifyFileStatus,
    shopifyFileUrl: v.optional(v.string()),
    keepStorageId: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const photo = await ctx.db.get(args.photoId);

    if (!photo) {
      throw new ConvexError("Photo not found.");
    }

    const now = Date.now();
    const patch: Partial<Doc<"productPhotos">> = {
      shopifyFileDeletedAt: undefined,
      shopifyFileId: args.shopifyFileId,
      shopifyFileStatus: args.shopifyFileStatus,
      status: "promoted",
      updatedAt: now,
      url: args.shopifyFileUrl ?? photo.url,
    };

    if (args.keepStorageId === false && photo.storageId) {
      await deleteStorageBlob(ctx, photo.storageId);
      patch.storageId = undefined;
    }

    await ctx.db.patch(args.photoId, patch);
    await ctx.db.patch(photo.productId, { updatedAt: now });
  },
});

export const clearStorageId = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const photo = await ctx.db.get(args.photoId);

    if (!photo) {
      throw new ConvexError("Photo not found.");
    }

    if (!photo.storageId) {
      return;
    }

    const now = Date.now();

    await deleteStorageBlob(ctx, photo.storageId);
    await ctx.db.patch(args.photoId, {
      storageId: undefined,
      updatedAt: now,
    });
  },
});
