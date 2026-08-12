import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * Soft ownership for productPhotos (model A).
 *
 * Product path keeps required `productId` + by_product indexes unchanged.
 * `ownerType` / `ownerId` are dual-written so a future gallery owner can share
 * the same table without a second photo pipeline.
 *
 * Until gallery lands, every row is product-owned: ownerId === String(productId).
 */

export const photoOwnerType = v.union(
  v.literal("product"),
  v.literal("gallery"),
);

export type PhotoOwnerType = "product" | "gallery";

export type ProductPhotoOwnership = {
  productId: Id<"products">;
  ownerType: "product";
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
