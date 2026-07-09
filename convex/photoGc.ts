import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import { applyDeletePhoto } from "./productPhotos";

/**
 * Safety-net GC for Convex `_storage` blobs left on promoted product photos.
 *
 * `shopify.promotePhotoToShopify` / `promotePhotoInternal` already clear storage
 * on success via `clearStorageIdInternal` after `markPromotedInternal`. Failed
 * promote leaves Convex storage intact so retry can re-upload.
 *
 * This sweep catches orphans where promote marked Shopify ready but storageId
 * was never cleared (crash between mark + clear, or older rows).
 *
 * Also cleans abandoned reserved upload slots (original status uploading, no
 * storageId) older than ABANDONED_UPLOAD_TTL_MS so max-photo capacity recovers.
 */

const GC_BATCH_SIZE = 25;
const ABANDONED_UPLOAD_TTL_MS = 60 * 60 * 1000; // 1 hour

async function deleteStorageBlob(ctx: MutationCtx, storageId: Id<"_storage">) {
  try {
    await ctx.storage.delete(storageId);
  } catch {
    // Storage may already be gone; ignore.
  }
}

/**
 * Clear Convex storage for promoted photos that already have Shopify file + URL.
 * Never deletes storage for non-promoted photos (failed promote keeps blobs for retry).
 *
 * Candidate set: status "promoted" (by_status index). Rows with shopifyFileId +
 * storageId but status !== "promoted" are intentionally skipped.
 */
async function runGcPromotedStorage(ctx: MutationCtx, requestedLimit?: number) {
  const limit = Math.min(
    Math.max(requestedLimit ?? GC_BATCH_SIZE, 1),
    GC_BATCH_SIZE,
  );
  const now = Date.now();
  let cleared = 0;
  let scanned = 0;

  const promoted = await ctx.db
    .query("productPhotos")
    .withIndex("by_status", (q) => q.eq("status", "promoted"))
    .collect();

  for (const photo of promoted) {
    scanned += 1;

    // Only GC when Shopify identity + ready URL remain alongside storageId.
    if (!photo.shopifyFileId || !photo.url || !photo.storageId) {
      continue;
    }

    await deleteStorageBlob(ctx, photo.storageId);
    await ctx.db.patch(photo._id, {
      storageId: undefined,
      updatedAt: now,
    });
    cleared += 1;

    if (cleared >= limit) {
      break;
    }
  }

  return {
    cleared,
    scanned,
    limit,
    hasMore: cleared >= limit,
  };
}

/**
 * Delete reserved original (+ paired AI) slots that never received a storageId.
 * Frees max-photo capacity after abandoned uploads.
 */
async function runGcAbandonedUploads(
  ctx: MutationCtx,
  requestedLimit?: number,
) {
  const limit = Math.min(
    Math.max(requestedLimit ?? GC_BATCH_SIZE, 1),
    GC_BATCH_SIZE,
  );
  const cutoff = Date.now() - ABANDONED_UPLOAD_TTL_MS;
  let deleted = 0;
  let scanned = 0;

  const uploading = await ctx.db
    .query("productPhotos")
    .withIndex("by_status", (q) => q.eq("status", "uploading"))
    .collect();

  for (const photo of uploading) {
    scanned += 1;

    if (photo.kind !== "original") {
      continue;
    }

    if (photo.storageId) {
      continue;
    }

    if (photo.createdAt > cutoff) {
      continue;
    }

    // Skip Shopify-backed rows (delete via shopify.deleteProductPhoto).
    if (photo.shopifyFileId) {
      continue;
    }

    await applyDeletePhoto(ctx, photo._id);
    deleted += 1;

    if (deleted >= limit) {
      break;
    }
  }

  return {
    deleted,
    scanned,
    limit,
    hasMore: deleted >= limit,
  };
}

export const gcPromotedStorage = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await runGcPromotedStorage(ctx, args.limit);
  },
});

export const gcAbandonedUploads = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await runGcAbandonedUploads(ctx, args.limit);
  },
});

/** Manual ops entrypoint; prefer cron / post-promote schedule for routine GC. */
export const runPhotoStorageGc = mutation({
  args: {
    sessionToken: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await runGcPromotedStorage(ctx, args.limit);
  },
});

/** Manual ops entrypoint for abandoned reserved-slot cleanup. */
export const runAbandonedUploadGc = mutation({
  args: {
    sessionToken: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await runGcAbandonedUploads(ctx, args.limit);
  },
});
