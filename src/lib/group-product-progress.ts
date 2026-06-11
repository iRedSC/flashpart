type ProductStatus =
  | "imported"
  | "grouped"
  | "captured"
  | "processing"
  | "draftCreated"
  | "published"
  | "failed"
  | "blockedExistingSku"
  | "needsReview";

export type GroupProductProgress = {
  pending: number;
  captured: number;
  published: number;
  total: number;
};

export function groupProductProgress<T extends { status: ProductStatus }>(
  products: T[],
): GroupProductProgress {
  let pending = 0;
  let captured = 0;
  let published = 0;

  for (const product of products) {
    if (product.status === "published") {
      published += 1;
    } else if (
      product.status === "captured" ||
      product.status === "processing" ||
      product.status === "needsReview" ||
      product.status === "draftCreated"
    ) {
      captured += 1;
    } else {
      pending += 1;
    }
  }

  return {
    pending,
    captured,
    published,
    total: products.length,
  };
}
