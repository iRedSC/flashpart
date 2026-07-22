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
import { maybeUnarchiveGroupForActiveProduct } from "./groups";
import type { AiImageModelId } from "./photoAiConstants";
import { aiImageModel } from "./photoAiConstants";
import { productErrorFields, isLinkedToShopify, needsRepublishPatch } from "./productState";
import { photoKind, shopifyFileStatus } from "./schema";
import {
  getSettingsDocument,
  resolveMaxProductPhotos,
} from "./settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processProductPhotoRef = makeFunctionReference(
  "photoAiProcess.js:processProductPhoto",
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

/**
 * Prefer a single AI row per original. Duplicates are rare (race / bad data);
 * never throw — pick a stable non-failed row, else the newest.
 */
export async function getAiForOriginal(
  ctx: DbCtx,
  originalPhotoId: Id<"productPhotos">,
) {
  const matches = await ctx.db
    .query("productPhotos")
    .withIndex("by_source", (q) => q.eq("sourcePhotoId", originalPhotoId))
    .collect();

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  const byNewest = [...matches].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return right.createdAt - left.createdAt;
  });

  const nonFailed = byNewest.find(
    (photo) =>
      photo.aiStatus !== "failed" && photo.status !== "failed",
  );

  return nonFailed ?? byNewest[0];
}

/** Originals that count toward max capacity (includes reserved uploading slots). */
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
 * Requires ≥1 original, and every original paired with an approved ready AI.
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

  if (originals.length < 1) {
    return { ok: false, reason: "missingOriginal" };
  }

  const approvedAiPhotos: Doc<"productPhotos">[] = [];

  for (const original of originals) {
    // Empty reserved slots are not publishable (capacity ignores them; gate does not).
    if (original.status === "uploading" && original.storageId == null) {
      return { ok: false, reason: "missingOriginal" };
    }

    if (
      original.status === "failed" ||
      original.shopifyFileStatus === "failed"
    ) {
      // Map terminal failures to existing reason (listingJobs treats as needs-review).
      return { ok: false, reason: "aiNotApproved" };
    }

    const aiPhoto = await getAiForOriginal(ctx, original._id);

    if (!aiPhoto) {
      return { ok: false, reason: "aiMissing" };
    }

    if (aiPhoto.aiStatus === "generating") {
      return { ok: false, reason: "aiGenerating" };
    }

    // AI generation failures block publish. Shopify promote failures are
    // retryable (storage kept; listing job re-uploads) so do not gate on
    // shopifyFileStatus === "failed" alone.
    if (aiPhoto.aiStatus === "failed" || aiPhoto.status === "failed") {
      return { ok: false, reason: "aiNotApproved" };
    }

    if (aiPhoto.aiStatus !== "ready" || aiPhoto.approvedAt === undefined) {
      return { ok: false, reason: "aiNotApproved" };
    }

    approvedAiPhotos.push(aiPhoto);
  }

  return {
    ok: true,
    approvedAiPhotos,
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
 * When no photo rows remain, clears multi-photo-derived badges and re-derives
 * from legacy shopifyFile* / aiShopifyFile* when those are still present.
 * When rows exist, badges come only from productPhotos (ignore legacy denorm).
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
    const hasLegacy =
      Boolean(product.shopifyFileId) || Boolean(product.aiShopifyFileId);

    if (!hasLegacy) {
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
      return;
    }

    // Rows gone but legacy Shopify fields remain: clear derived flags, then
    // re-derive badges from legacy AI / original file presence.
    const legacyPatch: Partial<Doc<"products">> = {
      needsPhotoReview: undefined,
      updatedAt: now,
    };

    if (product.pendingOperation === "aiImageGenerating") {
      legacyPatch.pendingOperation = undefined;
    }

    if (product.aiShopifyFileId) {
      legacyPatch.aiImageStatus =
        product.aiShopifyFileStatus === "failed" ? "failed" : "ready";
      if (legacyPatch.aiImageStatus === "ready") {
        legacyPatch.needsPhotoReview = true;
      }
    } else {
      legacyPatch.aiImageStatus = undefined;
    }

    await ctx.db.patch(productId, legacyPatch);
    return;
  }

  const originals = await getOriginalPhotos(ctx, productId);
  const aiPhotos = await getAiPhotos(ctx, productId);
  // Prefer non-failed / newest when duplicate sourcePhotoId rows exist.
  const aiBySource = new Map<Id<"productPhotos">, Doc<"productPhotos">>();
  for (const photo of aiPhotos) {
    if (photo.sourcePhotoId === undefined) {
      continue;
    }
    const existing = aiBySource.get(photo.sourcePhotoId);
    if (!existing) {
      aiBySource.set(photo.sourcePhotoId, photo);
      continue;
    }
    const existingFailed =
      existing.aiStatus === "failed" || existing.status === "failed";
    const photoFailed =
      photo.aiStatus === "failed" || photo.status === "failed";
    if (existingFailed && !photoFailed) {
      aiBySource.set(photo.sourcePhotoId, photo);
    } else if (
      existingFailed === photoFailed &&
      (photo.updatedAt > existing.updatedAt ||
        (photo.updatedAt === existing.updatedAt &&
          photo.createdAt > existing.createdAt))
    ) {
      aiBySource.set(photo.sourcePhotoId, photo);
    }
  }

  const anyGenerating = aiPhotos.some(
    (photo) => photo.aiStatus === "generating",
  );
  const anyReadyUnapproved = aiPhotos.some(
    (photo) => photo.aiStatus === "ready" && photo.approvedAt === undefined,
  );
  // AI generation failures only — Shopify promote failures stay retryable.
  const anyFailed = aiPhotos.some(
    (photo) => photo.aiStatus === "failed" || photo.status === "failed",
  );
  const anyPending = aiPhotos.some((photo) => photo.aiStatus === "pending");
  // Product badge is "complete" only when every original has an approved ready AI.
  // Pending reserved slots / missing AIs must not leave a stale "ready".
  // Failed Shopify promote (shopifyFileStatus) does not block the ready badge.
  const allOriginalsHaveApprovedReadyAi =
    originals.length > 0 &&
    originals.every((original) => {
      const ai = aiBySource.get(original._id);
      return (
        ai != null &&
        ai.aiStatus === "ready" &&
        ai.status !== "failed" &&
        ai.approvedAt !== undefined
      );
    });
  const missingAiForOriginal = originals.some(
    (original) => !aiBySource.has(original._id),
  );

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
  } else if (anyFailed && !anyReadyUnapproved && !anyPending) {
    patch.aiImageStatus = "failed";
    patch.needsPhotoReview = undefined;
    clearAiGeneratingPending();
  } else if (allOriginalsHaveApprovedReadyAi) {
    patch.needsPhotoReview = undefined;
    clearAiGeneratingPending();
    patch.aiImageStatus = "ready";
  } else if (aiPhotos.length === 0 && originals.length > 0) {
    // Originals only — clear stale AI badge until generation starts.
    patch.needsPhotoReview = undefined;
    clearAiGeneratingPending();
    patch.aiImageStatus = undefined;
  } else {
    // Incomplete: pending reserved slots, partial approval, or missing AIs.
    patch.needsPhotoReview = undefined;
    clearAiGeneratingPending();
    if (anyPending || missingAiForOriginal) {
      patch.aiImageStatus = "pending";
    } else if (anyFailed) {
      patch.aiImageStatus = "failed";
    } else {
      patch.aiImageStatus = undefined;
    }
  }

  if (
    originals.length >= 1 &&
    (product.phase === "imported" || product.phase === undefined)
  ) {
    patch.phase = "captured";
  }

  // Photo work on a live Shopify listing means local media differs until republish.
  if (isLinkedToShopify(product) && (anyGenerating || anyReadyUnapproved)) {
    patch.needsRepublish = true;
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

/** Reject finalize/replace when storageId is already bound to another photo. */
async function assertStorageIdAvailable(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
  excludePhotoId?: Id<"productPhotos">,
) {
  const existing = await ctx.db
    .query("productPhotos")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();

  if (existing && existing._id !== excludePhotoId) {
    throw new ConvexError(
      "This upload is already attached to another product photo.",
    );
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
): Promise<{
  aiPhotoId: Id<"productPhotos">;
  aiGeneration: number;
  /** Cleared Shopify file ids — caller must delete via action (e.g. processProductPhoto). */
  previousShopifyFileIds: string[];
}> {
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
  const aiGeneration = (existingAi?.aiGeneration ?? 0) + 1;
  const previousShopifyFileIds: string[] = [];

  if (existingAi?.shopifyFileId) {
    previousShopifyFileIds.push(existingAi.shopifyFileId);
  }

  let aiPhotoId: Id<"productPhotos">;

  if (existingAi) {
    // Regen must not reuse a prior Shopify file on promote (clear even if
    // already generating — e.g. reserved slot or interrupted regen).
    // Callers schedule Shopify fileDelete with previousShopifyFileIds.
    await ctx.db.patch(existingAi._id, {
      aiError: undefined,
      aiGeneration,
      aiPrompt: prompt || existingAi.aiPrompt,
      aiStatus: "generating",
      approvedAt: undefined,
      shopifyFileDeletedAt: undefined,
      shopifyFileId: undefined,
      shopifyFileStatus: undefined,
      sortOrder: original.sortOrder,
      status: "uploading",
      // Keep prior Convex blob until markAiReady replaces it (stale jobs no-op).
      // Drop Shopify CDN url when there is no Convex blob to fall back to.
      url: existingAi.storageId ? existingAi.url : undefined,
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
      aiGeneration,
      aiPrompt: prompt || undefined,
      createdAt: now,
      updatedAt: now,
    });
  }

  await syncProductPhotoFlags(ctx, args.productId);

  return { aiPhotoId, aiGeneration, previousShopifyFileIds };
}

export async function applyMarkAiReady(
  ctx: MutationCtx,
  args: {
    storageId: Id<"_storage">;
    url?: string;
    aiGeneration: number;
    aiPhotoId?: Id<"productPhotos">;
    originalPhotoId?: Id<"productPhotos">;
    aiModel?: AiImageModelId;
  },
) {
  let aiPhoto: Doc<"productPhotos">;
  try {
    aiPhoto = await resolveAiPhotoRow(ctx, args);
  } catch {
    // Row deleted mid-run: drop the just-stored blob so it is not orphaned.
    await deleteStorageBlob(ctx, args.storageId);
    return null;
  }

  if ((aiPhoto.aiGeneration ?? 0) !== args.aiGeneration) {
    // Stale job: drop orphaned blob from this generation attempt.
    await deleteStorageBlob(ctx, args.storageId);
    return null;
  }

  const now = Date.now();
  const url = args.url ?? (await ctx.storage.getUrl(args.storageId));

  if (aiPhoto.storageId && aiPhoto.storageId !== args.storageId) {
    await deleteStorageBlob(ctx, aiPhoto.storageId);
  }

  // Always clear Shopify identity so a concurrent promote cannot leave a stale
  // file id that the next promote would resume.
  await ctx.db.patch(aiPhoto._id, {
    aiError: undefined,
    aiModel: args.aiModel,
    aiStatus: "ready",
    approvedAt: undefined,
    shopifyFileDeletedAt: undefined,
    shopifyFileId: undefined,
    shopifyFileStatus: undefined,
    storageId: args.storageId,
    status: "ready",
    url: url ?? undefined,
    updatedAt: now,
  });

  await syncProductPhotoFlags(ctx, aiPhoto.productId);

  return aiPhoto._id;
}

/**
 * Replace AI image bytes after on-demand whitening. Unlike applyMarkAiReady,
 * keeps approvedAt so Approve → Whiten does not bounce the photo back to review.
 * Still clears Shopify file identity because the pixels changed.
 */
export async function applyWhitenAiReady(
  ctx: MutationCtx,
  args: {
    storageId: Id<"_storage">;
    url?: string;
    aiGeneration: number;
    aiPhotoId?: Id<"productPhotos">;
    originalPhotoId?: Id<"productPhotos">;
    aiModel?: AiImageModelId;
  },
) {
  let aiPhoto: Doc<"productPhotos">;
  try {
    aiPhoto = await resolveAiPhotoRow(ctx, args);
  } catch {
    await deleteStorageBlob(ctx, args.storageId);
    return null;
  }

  if ((aiPhoto.aiGeneration ?? 0) !== args.aiGeneration) {
    await deleteStorageBlob(ctx, args.storageId);
    return null;
  }

  const now = Date.now();
  const url = args.url ?? (await ctx.storage.getUrl(args.storageId));

  if (aiPhoto.storageId && aiPhoto.storageId !== args.storageId) {
    await deleteStorageBlob(ctx, aiPhoto.storageId);
  }

  await ctx.db.patch(aiPhoto._id, {
    aiError: undefined,
    aiModel: args.aiModel ?? aiPhoto.aiModel,
    aiStatus: "ready",
    shopifyFileDeletedAt: undefined,
    shopifyFileId: undefined,
    shopifyFileStatus: undefined,
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
    aiGeneration: number;
    aiPhotoId?: Id<"productPhotos">;
    originalPhotoId?: Id<"productPhotos">;
  },
) {
  let aiPhoto: Doc<"productPhotos">;
  try {
    aiPhoto = await resolveAiPhotoRow(ctx, args);
  } catch {
    // Row deleted mid-run: no-op (caller may still clean up a stored blob).
    return null;
  }

  if ((aiPhoto.aiGeneration ?? 0) !== args.aiGeneration) {
    return null;
  }

  const now = Date.now();

  await ctx.db.patch(aiPhoto._id, {
    aiError: args.error,
    aiStatus: "failed",
    status: "failed",
    updatedAt: now,
  });

  const product = await ctx.db.get(aiPhoto.productId);

  if (product) {
    // Mirror legacy photoAi.markFailed so list/archive surfaces the failure.
    await ctx.db.patch(aiPhoto.productId, {
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
    await maybeUnarchiveGroupForActiveProduct(ctx, product.groupId, now);
  }

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
    /**
     * Generation token captured at promote start. Abort if the AI row was
     * regenerated (or is no longer approved/ready) before this mark lands.
     */
    expectedAiGeneration?: number;
    /**
     * When false, persist Shopify file identity without status "promoted"
     * (post-fileCreate, pre-poll). Default true — only mark promoted after ready.
     */
    markAsPromoted?: boolean;
  },
) {
  const photo = await ctx.db.get(args.photoId);

  if (!photo) {
    throw new ConvexError("Photo not found.");
  }

  // Re-assert eligibility at mark time so an in-flight promote cannot stamp a
  // stale Shopify file onto a regenerated / unapproved AI row.
  if (photo.kind === "ai") {
    if (photo.aiStatus !== "ready") {
      throw new ConvexError("AI photo is no longer ready for publish.");
    }

    if (photo.approvedAt == null) {
      throw new ConvexError("AI photo is no longer approved for publish.");
    }

    if (
      args.expectedAiGeneration !== undefined &&
      (photo.aiGeneration ?? 0) !== args.expectedAiGeneration
    ) {
      throw new ConvexError(
        "AI photo was regenerated during promote; aborting stale promote.",
      );
    }
  }

  const now = Date.now();
  const patch: Partial<Doc<"productPhotos">> = {
    shopifyFileDeletedAt: undefined,
    shopifyFileId: args.shopifyFileId,
    shopifyFileStatus: args.shopifyFileStatus,
    updatedAt: now,
    url: args.shopifyFileUrl ?? photo.url,
  };

  if (args.markAsPromoted !== false) {
    patch.status = "promoted";
  }

  // Always clear storage when keepStorageId is explicitly false.
  // (promotePhotoToShopify clears via clearStorageId after mark; photoGc is the safety net.)
  if (args.keepStorageId === false && photo.storageId) {
    await deleteStorageBlob(ctx, photo.storageId);
    patch.storageId = undefined;
  }

  await ctx.db.patch(args.photoId, patch);
  await ctx.db.patch(photo.productId, { updatedAt: now });
}

/**
 * Terminal Shopify promote failure: keep Convex storage + AI readiness for retry.
 * Only stamp shopifyFileStatus failed — do not flip aiStatus/status to failed
 * (that permanently blocks republish until regen).
 */
export async function applyMarkPromoteFailed(
  ctx: MutationCtx,
  args: {
    photoId: Id<"productPhotos">;
    shopifyFileId?: string;
    shopifyFileStatus?: "uploaded" | "processing" | "ready" | "failed";
    shopifyFileUrl?: string;
  },
) {
  const photo = await ctx.db.get(args.photoId);

  if (!photo) {
    throw new ConvexError("Photo not found.");
  }

  const now = Date.now();
  const promoteError =
    "Shopify file promote failed. Retry publish after fixing the upload.";

  const patch: Partial<Doc<"productPhotos">> = {
    shopifyFileId: args.shopifyFileId ?? photo.shopifyFileId,
    shopifyFileStatus: args.shopifyFileStatus ?? "failed",
    url: args.shopifyFileUrl ?? photo.url,
    updatedAt: now,
  };

  if (photo.kind === "ai") {
    // Keep aiStatus/status ready when generation succeeded so publish can retry.
    if (photo.aiStatus === "ready") {
      patch.status = "ready";
      patch.aiError = promoteError;
    } else {
      patch.status = "failed";
      patch.aiStatus = "failed";
      patch.aiError = promoteError;
    }
  } else {
    patch.status = "failed";
  }

  await ctx.db.patch(args.photoId, patch);
  await ctx.db.patch(photo.productId, { updatedAt: now });
  await syncProductPhotoFlags(ctx, photo.productId);
}

export async function applyClearStorageId(
  ctx: MutationCtx,
  photoId: Id<"productPhotos">,
  options?: {
    expectedStorageId?: Id<"_storage">;
    expectedAiGeneration?: number;
  },
) {
  const photo = await ctx.db.get(photoId);

  if (!photo) {
    throw new ConvexError("Photo not found.");
  }

  if (!photo.storageId) {
    return;
  }

  // Stale promote must not delete a blob attached after regen.
  if (
    options?.expectedStorageId !== undefined &&
    photo.storageId !== options.expectedStorageId
  ) {
    return;
  }

  if (
    options?.expectedAiGeneration !== undefined &&
    (photo.aiGeneration ?? 0) !== options.expectedAiGeneration
  ) {
    return;
  }

  const now = Date.now();
  const storageId = photo.storageId;

  await deleteStorageBlob(ctx, storageId);
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

  const product = await ctx.db.get(photo.productId);
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

  if (product && isLinkedToShopify(product)) {
    await ctx.db.patch(photo.productId, {
      needsRepublish: true,
      updatedAt: Date.now(),
    });
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

/**
 * Like listForProducts, but re-signs Convex storage URLs when storageId is
 * present so ZIP export can fetch blobs even if the stored url has expired.
 */
export const listExportPhotosForProducts = query({
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
        const photos = await listPhotosForProduct(ctx, productId);
        photosByProductId[productId] = await Promise.all(
          photos.map(async (photo) => {
            if (!photo.storageId) {
              return photo;
            }

            const freshUrl = await ctx.storage.getUrl(photo.storageId);
            if (!freshUrl) {
              return photo;
            }

            return { ...photo, url: freshUrl };
          }),
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

/**
 * Best-effort delete of an uploaded blob that was never bound to a photo row
 * (e.g. replaceOriginalFromUpload failed after uploadCaptureFile).
 */
export const deleteUploadedStorage = mutation({
  args: {
    sessionToken: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    const bound = await ctx.db
      .query("productPhotos")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();

    if (bound) {
      return;
    }

    await deleteStorageBlob(ctx, args.storageId);
  },
});

async function insertReservedOriginalPair(
  ctx: MutationCtx,
  args: {
    productId: Id<"products">;
    captureId?: Id<"captures">;
  },
) {
  const product = await ctx.db.get(args.productId);

  if (!product) {
    throw new ConvexError("Product not found.");
  }

  if (product.phase === "published" || product.shopifyProductId) {
    throw new ConvexError(
      "Cannot add photos to a product that is already published to Shopify.",
    );
  }

  const settings = await getSettingsDocument(ctx);
  const maxPhotos = resolveMaxProductPhotos(settings);
  // Count reserved uploading slots toward max so concurrent reserves cannot
  // overshoot. Abandoned empty slots are GC'd after ABANDONED_UPLOAD_TTL_MS.
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
  const now = Date.now();
  const isFirstMultiPhotoRows = originals.length === 0;

  const originalPhotoId = await ctx.db.insert("productPhotos", {
    productId: args.productId,
    kind: "original",
    status: "uploading",
    sortOrder,
    captureId: args.captureId,
    createdAt: now,
    updatedAt: now,
  });

  // Pending until finalize schedules AI — do not mark generating on reserve.
  const aiPhotoId = await ctx.db.insert("productPhotos", {
    productId: args.productId,
    kind: "ai",
    status: "uploading",
    sortOrder,
    sourcePhotoId: originalPhotoId,
    aiStatus: "pending",
    aiGeneration: 0,
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

  // Hybrid legacy → multi-photo: clear legacy AI denorm so dual-read badges
  // cannot stay "ready" from aiShopifyFile* while productPhotos drive state.
  // Leave legacy shopifyFile* alone (original capture may still be referenced
  // until rows fully replace the legacy path); sync ignores them when rows exist.
  if (
    isFirstMultiPhotoRows &&
    (product.aiShopifyFileId || product.aiImageStatus)
  ) {
    productPatch.aiShopifyFileId = undefined;
    productPatch.aiShopifyFileStatus = undefined;
    productPatch.aiShopifyFileUrl = undefined;
    productPatch.aiImageError = undefined;
  }

  await ctx.db.patch(args.productId, productPatch);
  await syncProductPhotoFlags(ctx, args.productId);

  return { originalPhotoId, aiPhotoId };
}

async function finalizeReservedOriginal(
  ctx: MutationCtx,
  args: {
    originalPhotoId: Id<"productPhotos">;
    storageId: Id<"_storage">;
    captureId?: Id<"captures">;
  },
) {
  const original = await ctx.db.get(args.originalPhotoId);

  if (!original || original.kind !== "original") {
    throw new ConvexError("Original photo not found.");
  }

  if (original.status !== "uploading") {
    throw new ConvexError("Original photo is not awaiting upload.");
  }

  if (original.storageId) {
    throw new ConvexError("Original photo upload was already finalized.");
  }

  await assertStorageIdAvailable(ctx, args.storageId, args.originalPhotoId);

  const url = await ctx.storage.getUrl(args.storageId);
  const now = Date.now();
  const patch: Partial<Doc<"productPhotos">> = {
    storageId: args.storageId,
    status: "ready",
    url: url ?? undefined,
    updatedAt: now,
  };

  if (args.captureId) {
    patch.captureId = args.captureId;
  }

  await ctx.db.patch(args.originalPhotoId, patch);

  // Mark AI generating + bump generation only when work is scheduled.
  const { aiGeneration, previousShopifyFileIds } = await applyMarkAiGenerating(
    ctx,
    {
      productId: original.productId,
      originalPhotoId: args.originalPhotoId,
    },
  );

  const productPatch: Partial<Doc<"products">> = {
    lastError: undefined,
    updatedAt: now,
  };

  if (args.captureId) {
    productPatch.captureId = args.captureId;
  }

  await ctx.db.patch(original.productId, productPatch);
  // applyMarkAiGenerating already synced flags; sync again after product patch.
  await syncProductPhotoFlags(ctx, original.productId);

  await ctx.scheduler.runAfter(0, processProductPhotoRef, {
    productId: original.productId,
    originalPhotoId: args.originalPhotoId,
    aiGeneration,
    previousShopifyFileIds:
      previousShopifyFileIds.length > 0 ? previousShopifyFileIds : undefined,
  });

  return args.originalPhotoId;
}

/** Reserve original + AI slots before upload so UI queries see them immediately. */
export const reserveOriginalSlot = mutation({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
    captureId: v.optional(v.id("captures")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await insertReservedOriginalPair(ctx, {
      productId: args.productId,
      captureId: args.captureId,
    });
  },
});

/** Attach storage to a reserved original and schedule AI processing. */
export const finalizeOriginalUpload = mutation({
  args: {
    sessionToken: v.string(),
    originalPhotoId: v.id("productPhotos"),
    storageId: v.id("_storage"),
    captureId: v.optional(v.id("captures")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await finalizeReservedOriginal(ctx, {
      originalPhotoId: args.originalPhotoId,
      storageId: args.storageId,
      captureId: args.captureId,
    });
  },
});

/** Compatibility: reserve + finalize in one mutation (prefer reserve → upload → finalize). */
export const createOriginalFromUpload = mutation({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
    storageId: v.id("_storage"),
    captureId: v.optional(v.id("captures")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const { originalPhotoId } = await insertReservedOriginalPair(ctx, {
      productId: args.productId,
      captureId: args.captureId,
    });

    return await finalizeReservedOriginal(ctx, {
      originalPhotoId,
      storageId: args.storageId,
      captureId: args.captureId,
    });
  },
});

/**
 * Replace an existing original's storage in-place (same slot / sortOrder).
 * Resets the paired AI row and schedules regeneration.
 */
export const replaceOriginalFromUpload = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
    storageId: v.id("_storage"),
    captureId: v.optional(v.id("captures")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const photo = await ctx.db.get(args.photoId);

    if (!photo || photo.kind !== "original") {
      throw new ConvexError("Original photo not found.");
    }

    if (photo.status === "uploading" && !photo.storageId) {
      throw new ConvexError(
        "Finalize the reserved upload instead of replacing it.",
      );
    }

    const product = await ctx.db.get(photo.productId);

    if (!product) {
      throw new ConvexError("Product not found.");
    }

    await assertStorageIdAvailable(ctx, args.storageId, args.photoId);

    const oldStorageId = photo.storageId;
    const url = await ctx.storage.getUrl(args.storageId);
    const now = Date.now();
    const previousShopifyFileIds: string[] = [];

    if (photo.shopifyFileId) {
      previousShopifyFileIds.push(photo.shopifyFileId);
    }

    await ctx.db.patch(args.photoId, {
      storageId: args.storageId,
      url: url ?? undefined,
      status: "ready",
      shopifyFileId: undefined,
      shopifyFileStatus: undefined,
      shopifyFileDeletedAt: undefined,
      captureId: args.captureId ?? photo.captureId,
      updatedAt: now,
    });

    const { aiGeneration, previousShopifyFileIds: aiShopifyFileIds } =
      await applyMarkAiGenerating(ctx, {
        productId: photo.productId,
        originalPhotoId: args.photoId,
      });
    previousShopifyFileIds.push(...aiShopifyFileIds);

    // Replace drops the prior AI blob immediately (regen keeps it until ready).
    const aiChild = await getAiForOriginal(ctx, args.photoId);
    if (aiChild?.storageId) {
      const oldAiStorageId = aiChild.storageId;
      await ctx.db.patch(aiChild._id, {
        storageId: undefined,
        url: undefined,
        updatedAt: now,
      });
      if (oldAiStorageId !== args.storageId) {
        await deleteStorageBlob(ctx, oldAiStorageId);
      }
    }

    const productPatch: Partial<Doc<"products">> = {
      lastError: undefined,
      updatedAt: now,
      ...needsRepublishPatch(product),
    };

    if (args.captureId) {
      productPatch.captureId = args.captureId;
    }

    await ctx.db.patch(photo.productId, productPatch);
    await syncProductPhotoFlags(ctx, photo.productId);

    await ctx.scheduler.runAfter(0, processProductPhotoRef, {
      productId: photo.productId,
      originalPhotoId: args.photoId,
      aiGeneration,
      previousShopifyFileIds:
        previousShopifyFileIds.length > 0 ? previousShopifyFileIds : undefined,
    });

    if (oldStorageId && oldStorageId !== args.storageId) {
      await deleteStorageBlob(ctx, oldStorageId);
    }

    return args.photoId;
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
    const product = await ctx.db.get(photo.productId);

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

    await ctx.db.patch(photo.productId, {
      updatedAt: now,
      ...(product ? needsRepublishPatch(product) : {}),
    });
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

/**
 * Convex-only delete. Throws if the photo (or paired AI) has Shopify file IDs —
 * callers must use shopify.deleteProductPhoto in that case.
 */
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

    if (photo.shopifyFileId) {
      throw new ConvexError(
        "This photo has a Shopify file. Use shopify.deleteProductPhoto instead.",
      );
    }

    if (photo.kind === "original") {
      const aiChild = await getAiForOriginal(ctx, photo._id);

      if (aiChild?.shopifyFileId) {
        throw new ConvexError(
          "The paired AI photo has a Shopify file. Use shopify.deleteProductPhoto instead.",
        );
      }
    }

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

/** Internal variants for photoAi / shopify actions (no session). */
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
    aiGeneration: v.number(),
    aiPhotoId: v.optional(v.id("productPhotos")),
    originalPhotoId: v.optional(v.id("productPhotos")),
    aiModel: v.optional(aiImageModel),
  },
  handler: async (ctx, args) => {
    return await applyMarkAiReady(ctx, args);
  },
});

export const whitenAiReadyInternal = internalMutation({
  args: {
    storageId: v.id("_storage"),
    url: v.optional(v.string()),
    aiGeneration: v.number(),
    aiPhotoId: v.optional(v.id("productPhotos")),
    originalPhotoId: v.optional(v.id("productPhotos")),
    aiModel: v.optional(aiImageModel),
  },
  handler: async (ctx, args) => {
    return await applyWhitenAiReady(ctx, args);
  },
});

export const markAiFailedInternal = internalMutation({
  args: {
    error: v.string(),
    aiGeneration: v.number(),
    aiPhotoId: v.optional(v.id("productPhotos")),
    originalPhotoId: v.optional(v.id("productPhotos")),
  },
  handler: async (ctx, args) => {
    return await applyMarkAiFailed(ctx, args);
  },
});

export const markPromotedInternal = internalMutation({
  args: {
    photoId: v.id("productPhotos"),
    shopifyFileId: v.string(),
    shopifyFileStatus: shopifyFileStatus,
    shopifyFileUrl: v.optional(v.string()),
    keepStorageId: v.optional(v.boolean()),
    expectedAiGeneration: v.optional(v.number()),
    markAsPromoted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await applyMarkPromoted(ctx, args);
  },
});

export const markPromoteFailedInternal = internalMutation({
  args: {
    photoId: v.id("productPhotos"),
    shopifyFileId: v.optional(v.string()),
    shopifyFileStatus: v.optional(shopifyFileStatus),
    shopifyFileUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await applyMarkPromoteFailed(ctx, args);
  },
});

export const clearStorageIdInternal = internalMutation({
  args: {
    photoId: v.id("productPhotos"),
    expectedStorageId: v.optional(v.id("_storage")),
    expectedAiGeneration: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await applyClearStorageId(ctx, args.photoId, {
      expectedStorageId: args.expectedStorageId,
      expectedAiGeneration: args.expectedAiGeneration,
    });
  },
});
