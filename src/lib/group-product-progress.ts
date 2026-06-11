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

export function isPendingCapture<T extends { status: ProductStatus; shopifyFileId?: string }>(
  product: T,
): boolean {
  if (product.status === "published") {
    return false;
  }

  if (
    product.status === "captured" ||
    product.status === "processing" ||
    product.status === "needsReview" ||
    product.status === "draftCreated" ||
    ((product.status === "failed" || product.status === "blockedExistingSku") &&
      Boolean(product.shopifyFileId))
  ) {
    return false;
  }

  return true;
}

export function nextUncapturedGroupProduct<
  T extends {
    status: ProductStatus;
    shopifyFileId?: string;
    groupId?: string;
    createdAt: number;
  },
>(products: T[], groupId: string): T | null {
  return (
    products
      .filter((product) => product.groupId === groupId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .find(isPendingCapture) ?? null
  );
}

export function groupProductProgress<T extends { status: ProductStatus; shopifyFileId?: string }>(
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
      product.status === "draftCreated" ||
      ((product.status === "failed" || product.status === "blockedExistingSku") &&
        Boolean(product.shopifyFileId))
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
