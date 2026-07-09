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

/**
 * Publish readiness for products that already have productPhotos rows.
 * Requires ≥1 original, ≥1 AI, every AI approved (no generating / failed / ready-unapproved).
 */
export async function evaluateProductPhotosPublishGate(
  ctx: DbCtx,
  productId: Id<"products">,
): Promise<
  | { ok: true; approvedAiPhotos: Doc<"productPhotos">[] }
  | {
      ok: false;
      reason:
        | "missingOriginal"
        | "aiGenerating"
        | "aiMissing"
        | "aiNotApproved";
    }
> {
  const originals = await getOriginalPhotos(ctx, productId);
  const aiPhotos = await getAiPhotos(ctx, productId);

  if (originals.length < 1) {
    return { ok: false, reason: "missingOriginal" };
  }

  if (aiPhotos.some((photo) => photo.aiStatus === "generating")) {
    return { ok: false, reason: "aiGenerating" };
  }

  if (aiPhotos.length < 1) {
    return { ok: false, reason: "aiMissing" };
  }

  if (aiPhotos.some((photo) => photo.approvedAt === undefined)) {
    return { ok: false, reason: "aiNotApproved" };
  }

  return {
    ok: true,
    approvedAiPhotos: aiPhotos,
  };
}

async function listPhotosForProduct(ctx: DbCtx, productId: Id<"products">) {
  const photos = await ctx.db
    .query("productPhotos")
    .withIndex("by_product", (q) => q.eq("productId", productId))
    .collect();

  return photos.sort(comparePhotoOrder);
}

/**
 * Keep product-level list badges in sync with productPhotos rows.
 * No-op when the product has no photo rows (legacy product fields own those).
 * Does not write shopifyFile* / aiShopifyFile* denorm for the multi-photo path.
 */
export async function syncProductPhotoFlags(
  ctx: MutationCtx,
  productId: Id<"products">,
) {
  const product = await ctx.db.get(productId);

  if (!product) {
    return;
  }

  const now = Date.now();

  if (!(await productHasPhotoRows(ctx, productId))) {
    // Last multi-photo rows were removed: clear derived badges without touching
    // legacy Shopify-hosted products (those still have shopifyFile* / aiShopify*).
    if (!product.shopifyFileId && !product.aiShopifyFileId) {
      const emptyPatch: Partial<Doc<"products">> = {
        aiImageStatus: undefined,
        needsPhotoReview: undefined,
        updatedAt: now,
      };

      if (product.pendingOperation === "aiImageGenerating") {
        emptyPatch.pendingOperation = undefined;
      }

      if (product.phase === "captured") {
        emptyPatch.phase = "imported";
      }

      await ctx.db.patch(productId, emptyPatch);
    }

    return;
  }

  const originals = await getOriginalPhotos(ctx, productId);
  const aiPhotos = await getAiPhotos(ctx, productId);

  const anyGenerating = aiPhotos.some(
    (photo) => photo.aiStatus === "generating",
  );
  const anyReadyUnapproved = aiPhotos.some(
    (photo) => photo.aiStatus === "ready" && photo.approvedAt === undefined,
  );
  const anyFailed = aiPhotos.some((photo) => photo.aiStatus === "failed");
  const anyApproved = aiPhotos.some((photo) => photo.approvedAt !== undefined);
  const allAisApproved =
    aiPhotos.length > 0 &&
    aiPhotos.every((photo) => photo.approvedAt !== undefined);

  const patch: Partial<Doc<"products">> = {
    updatedAt: now,
  };

  const clearAiGeneratingPending = () => {
    if (product.pendingOperation === "aiImageGenerating") {
      patch.pendingOperation = undefined;
    }
  };

  if (anyGenerating) {
    patch.pendingOperation = "aiImageGenerating";
    patch.aiImageStatus = "generating";
    // Sibling AIs may still need review while one is regenerating.
    patch.needsPhotoReview = anyReadyUnapproved ? true : undefined;
  } else if (anyReadyUnapproved) {
    patch.needsPhotoReview = true;
    patch.aiImageStatus = "ready";
    clearAiGeneratingPending();
  } else if (anyFailed && !anyReadyUnapproved) {
    patch.aiImageStatus = "failed";
    patch.needsPhotoReview = undefined;
    clearAiGeneratingPending();
  } else if (allAisApproved || (aiPhotos.length === 0 && originals.length > 0)) {
    patch.needsPhotoReview = undefined;
    clearAiGeneratingPending();
    if (anyApproved) {
      patch.aiImageStatus = "ready";
    } else if (aiPhotos.length === 0) {
      // Originals only — clear stale AI badge until generation starts.
      patch.aiImageStatus = undefined;
    }
  } else {
    patch.needsPhotoReview = undefined;
    clearAiGeneratingPending();
  }

  if (
    originals.length >= 1 &&
    (product.phase === "imported" || product.phase === undefined)
  ) {
    patch.phase = "captured";
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

  await syncProductPhotoFlags(ctx, args.productId);

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

  await syncProductPhotoFlags(ctx, aiPhoto.productId);

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

  await syncProductPhotoFlags(ctx, aiPhoto.productId);

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

  await syncProductPhotoFlags(ctx, photo.productId);
}

export async function applyMarkPromoted(
  ctx: MutationCtx,
  args: {
    photoId: Id<"productPhotos">;
    shopifyFileId: string;
    shopifyFileStatus:
      | "uploaded"
      | "processing"
      | "ready"
      | "failed";
    shopifyFileUrl?: string;
    /** When false, delete Convex storage immediately. Promote path usually keeps then clearStorageId. */
    keepStorageId?: boolean;
  },
) {
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

  // Always clear storage when keepStorageId is explicitly false.
  // (promotePhotoToShopify clears via clearStorageId after mark; photoGc is the safety net.)
  if (args.keepStorageId === false && photo.storageId) {
    await deleteStorageBlob(ctx, photo.storageId);
    patch.storageId = undefined;
  }

  await ctx.db.patch(args.photoId, patch);
  await ctx.db.patch(photo.productId, { updatedAt: now });
}

export async function applyClearStorageId(
  ctx: MutationCtx,
  photoId: Id<"productPhotos">,
) {
  const photo = await ctx.db.get(photoId);

  if (!photo) {
    throw new ConvexError("Photo not found.");
  }

  if (!photo.storageId) {
    return;
  }

  const now = Date.now();

  await deleteStorageBlob(ctx, photo.storageId);
  await ctx.db.patch(photoId, {
    storageId: undefined,
    updatedAt: now,
  });
}

export async function applyDeletePhoto(
  ctx: MutationCtx,
  photoId: Id<"productPhotos">,
) {
  const photo = await ctx.db.get(photoId);

  if (!photo) {
    throw new ConvexError("Photo not found.");
  }

  const toDelete: Doc<"productPhotos">[] = [photo];

  if (photo.kind === "original") {
    const aiChild = await getAiForOriginal(ctx, photo._id);

    if (aiChild) {
      toDelete.push(aiChild);
    }
  }

  for (const row of toDelete) {
    await deleteStorageBlob(ctx, row.storageId);
    // Shopify Files are deleted by shopify.deleteProductPhoto when present.
    await ctx.db.delete(row._id);
  }

  await syncProductPhotoFlags(ctx, photo.productId);
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

/** Batch photo fetch for product-list thumbnails (avoids N+1 listByProduct). */
export const listForProducts = query({
  args: {
    sessionToken: v.string(),
    productIds: v.array(v.id("products")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    const uniqueIds = [...new Set(args.productIds)];
    const photosByProductId: Record<string, Doc<"productPhotos">[]> = {};

    await Promise.all(
      uniqueIds.map(async (productId) => {
        photosByProductId[productId] = await listPhotosForProduct(
          ctx,
          productId,
        );
      }),
    );

    return photosByProductId;
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

    if (args.captureId) {
      productPatch.captureId = args.captureId;
    }

    await ctx.db.patch(args.productId, productPatch);
    // phase / needsPhotoReview / pendingOperation / aiImageStatus from rows
    await syncProductPhotoFlags(ctx, args.productId);

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

export const getPhotoForPromote = internalQuery({
  args: {
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    const photo = await ctx.db.get(args.photoId);

    if (!photo) {
      return null;
    }

    const product = await ctx.db.get(photo.productId);

    return {
      photo,
      sku: product?.sku ?? "product",
    };
  },
});

export const getPhotoForDeletion = internalQuery({
  args: {
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    const photo = await ctx.db.get(args.photoId);

    if (!photo) {
      return null;
    }

    const product = await ctx.db.get(photo.productId);
    const shopifyFileIds: string[] = [];

    if (photo.shopifyFileId) {
      shopifyFileIds.push(photo.shopifyFileId);
    }

    if (photo.kind === "original") {
      const aiChild = await getAiForOriginal(ctx, photo._id);

      if (aiChild?.shopifyFileId) {
        shopifyFileIds.push(aiChild.shopifyFileId);
      }
    }

    return {
      photoId: photo._id,
      productId: photo.productId,
      shopifyFileIds,
      shopifyStatus: product?.shopifyStatus,
    };
  },
});

export const deletePhoto = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
    /**
     * Informational: Shopify deletion is handled by shopify.deleteProductPhoto.
     * This mutation only removes Convex rows + storage.
     */
    shopifyFilesHandled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    await applyDeletePhoto(ctx, args.photoId);
  },
});

export const deletePhotoInternal = internalMutation({
  args: {
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    await applyDeletePhoto(ctx, args.photoId);
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
    await applyMarkPromoted(ctx, {
      photoId: args.photoId,
      shopifyFileId: args.shopifyFileId,
      shopifyFileStatus: args.shopifyFileStatus,
      shopifyFileUrl: args.shopifyFileUrl,
      keepStorageId: args.keepStorageId,
    });
  },
});

export const markPromotedInternal = internalMutation({
  args: {
    photoId: v.id("productPhotos"),
    shopifyFileId: v.string(),
    shopifyFileStatus: shopifyFileStatus,
    shopifyFileUrl: v.optional(v.string()),
    keepStorageId: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await applyMarkPromoted(ctx, args);
  },
});

export const clearStorageId = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    await applyClearStorageId(ctx, args.photoId);
  },
});

export const clearStorageIdInternal = internalMutation({
  args: {
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    await applyClearStorageId(ctx, args.photoId);
  },
});
