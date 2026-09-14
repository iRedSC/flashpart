import type { Id } from "../../convex/_generated/dataModel";

const OPTIMISTIC_PRODUCT_ID_PREFIX = "optimistic-product-";

export function persistedProductIds(
  products: ReadonlyArray<{ _id: string }>,
): Id<"products">[] {
  return products
    .map((product) => product._id)
    .filter(
      (productId): productId is Id<"products"> =>
        !productId.startsWith(OPTIMISTIC_PRODUCT_ID_PREFIX),
    );
}
