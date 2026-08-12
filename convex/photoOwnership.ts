import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Soft ownership for productPhotos (model A).
 *
 * Product path keeps `productId` + by_product indexes for product-owned rows.
 * Gallery rows use ownerType/ownerId without a productId.
 */

export const photoOwnerType = v.union(
  v.literal("product"),
  v.literal("gallery"),
);

export type PhotoOwnerType = "product" | "gallery";

/** Shared single-tenant gallery bucket until albums exist. */
export const DEFAULT_GALLERY_OWNER_ID = "default";

export type ProductPhotoOwnership = {
  productId: Id<"products">;
  ownerType: "product";
  ownerId: string;
};

export type GalleryPhotoOwnership = {
  productId?: undefined;
  ownerType: "gallery";
  ownerId: string;
};

/** Fields to set on every product-owned photo insert/patch. */
export function productPhotoOwnership(
  productId: Id<"products">,
): ProductPhotoOwnership {
  return {
    productId,
    ownerType: "product",
    ownerId: productId,
  };
}

/** Fields to set on gallery-owned photo inserts. */
export function galleryPhotoOwnership(
  ownerId: string = DEFAULT_GALLERY_OWNER_ID,
): GalleryPhotoOwnership {
  return {
    ownerType: "gallery",
    ownerId,
  };
}

/** Product-only helpers must call this before using photo.productId. */
export function requirePhotoProductId(
  photo: Doc<"productPhotos">,
): Id<"products"> {
  if (photo.productId == null) {
    throw new ConvexError("Photo is not linked to a product.");
  }

  return photo.productId;
}

export function isGalleryPhoto(photo: Doc<"productPhotos">): boolean {
  return photo.ownerType === "gallery";
}

/**
 * Shopify Files basename segment for photo kind.
 * DB kind stays "ai"; public filenames use "edited".
 */
export function shopifyPhotoKindLabel(kind: "original" | "ai"): string {
  return kind === "ai" ? "edited" : "original";
}

export function shopifyPhotoAltLabel(kind: "original" | "ai"): string {
  return kind === "ai" ? "edited" : "original";
}
