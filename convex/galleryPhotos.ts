import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import {
  DEFAULT_GALLERY_OWNER_ID,
  galleryPhotoOwnership,
  isGalleryPhoto,
} from "./photoOwnership";
import { applyDeletePhoto } from "./productPhotos";

type DbCtx = QueryCtx | MutationCtx;

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

/** Gallery originals only (no AI pair yet — keeps product AI pipeline untouched). */
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

/**
 * Attach an uploaded Convex blob as a gallery original.
 * Does not create an AI sibling or schedule product photo processing.
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

    const photoId = await ctx.db.insert("productPhotos", {
      ...ownership,
      kind: "original",
      storageId: args.storageId,
      url: url ?? undefined,
      status: "ready",
      sortOrder: maxSortOrder + 1,
      createdAt: now,
      updatedAt: now,
    });

    return photoId;
  },
});

/** Delete a gallery original (Convex storage only; no Shopify promote yet). */
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
        "This photo is on Shopify. Remove it from Shopify before deleting.",
      );
    }

    await applyDeletePhoto(ctx, args.photoId);
    return null;
  },
});
