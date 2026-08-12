import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import { productPhotoOwnership } from "./photoOwnership";
import { migrateLegacyProduct } from "./productState";

export const migrateProductsToPhase = internalMutation({
  args: {},
  handler: async (ctx) => {
    const products = await ctx.db.query("products").collect();
    let migrated = 0;

    for (const product of products) {
      const patch = migrateLegacyProduct(product);

      if (!patch) {
        continue;
      }

      await ctx.db.patch(product._id, patch);
      migrated += 1;
    }

    const captures = await ctx.db.query("captures").collect();

    for (const capture of captures) {
      const status = capture.status as string;
      let newStatus: "recorded" | "fileProcessing" | "ready" | "failed";

      switch (status) {
        case "fileProcessing":
        case "processing":
          newStatus = "fileProcessing";
          break;
        case "ready":
        case "processed":
          newStatus = "ready";
          break;
        case "failed":
          newStatus = "failed";
          break;
        default:
          newStatus = "recorded";
      }

      if (newStatus !== status) {
        await ctx.db.patch(capture._id, { status: newStatus });
      }
    }

    return { migrated };
  },
});

const BACKFILL_BATCH_SIZE = 100;

/**
 * Backfill soft ownership on productPhotos (model A).
 * Idempotent: skips rows that already have matching product ownership.
 * Batched so large tables can be drained with repeated calls.
 */
async function backfillPhotoOwnershipBatch(
  ctx: MutationCtx,
  requestedLimit?: number,
) {
  const limit = Math.min(
    Math.max(requestedLimit ?? BACKFILL_BATCH_SIZE, 1),
    BACKFILL_BATCH_SIZE,
  );
  const photos = await ctx.db.query("productPhotos").collect();
  let patched = 0;
  let skipped = 0;
  let scanned = 0;

  for (const photo of photos) {
    scanned += 1;
    if (photo.productId == null) {
      skipped += 1;
      continue;
    }

    const ownership = productPhotoOwnership(photo.productId);
    if (
      photo.ownerType === ownership.ownerType &&
      photo.ownerId === ownership.ownerId
    ) {
      skipped += 1;
      continue;
    }

    await ctx.db.patch(photo._id, ownership);
    patched += 1;

    if (patched >= limit) {
      break;
    }
  }

  return {
    patched,
    skipped,
    scanned,
    total: photos.length,
    hasMore: patched >= limit,
  };
}

/** Internal one-shot / cron-friendly entry. */
export const backfillPhotoOwnership = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await backfillPhotoOwnershipBatch(ctx, args.limit);
  },
});

/** Manual ops entrypoint (session required). Re-run until hasMore is false. */
export const runBackfillPhotoOwnership = mutation({
  args: {
    sessionToken: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await backfillPhotoOwnershipBatch(ctx, args.limit);
  },
});
