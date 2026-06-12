export type ProductPhase = "imported" | "captured" | "published";

export type PendingOperation = "captureProcessing" | "publishing";

export type ProductErrorCode =
  | "duplicateSku"
  | "shopifyApi"
  | "captureUpload"
  | "unknown";

export type LastError = {
  code: ProductErrorCode;
  message: string;
  operation?: PendingOperation;
  at: number;
};

export type ProductStateFields = {
  phase: ProductPhase;
  pendingOperation?: PendingOperation;
  needsPhotoReview?: boolean;
  lastError?: LastError;
  shopifyFileId?: string;
};

export type GroupProductProgress = {
  pending: number;
  captured: number;
  published: number;
  total: number;
};

export function isPendingCapture(product: { phase: ProductPhase }): boolean {
  return product.phase === "imported";
}

export function isGroupCaptureComplete(product: { phase: ProductPhase }): boolean {
  return product.phase === "captured" || product.phase === "published";
}

export function isPublishable(product: ProductStateFields): boolean {
  return (
    product.phase === "captured" &&
    Boolean(product.shopifyFileId) &&
    !product.pendingOperation
  );
}

export function hasActiveError(product: { lastError?: LastError }): boolean {
  return product.lastError !== undefined;
}

export function compareProductDisplayOrder<
  T extends { sortOrder?: number; createdAt: number },
>(left: T, right: T): number {
  if (left.sortOrder !== undefined && right.sortOrder !== undefined) {
    return left.sortOrder - right.sortOrder;
  }

  if (left.sortOrder === undefined && right.sortOrder === undefined) {
    return right.createdAt - left.createdAt;
  }

  return left.sortOrder === undefined ? -1 : 1;
}

export function nextUncapturedGroupProduct<
  T extends {
    phase: ProductPhase;
    groupId?: string;
    sortOrder?: number;
    createdAt: number;
  },
>(products: T[], groupId: string): T | null {
  return (
    products
      .filter((product) => product.groupId === groupId)
      .sort(compareProductDisplayOrder)
      .find(isPendingCapture) ?? null
  );
}

export function nextUncapturedSelectionProduct<
  T extends {
    _id: string;
    phase: ProductPhase;
    sortOrder?: number;
    createdAt: number;
  },
>(products: T[], productIds: string[]): T | null {
  const idSet = new Set(productIds);

  return (
    products
      .filter((product) => idSet.has(product._id))
      .sort(compareProductDisplayOrder)
      .find(isPendingCapture) ?? null
  );
}

export function selectionCaptureProgress<
  T extends {
    _id: string;
    phase: ProductPhase;
  },
>(products: T[], productIds: string[]) {
  const idSet = new Set(productIds);
  const selectionProducts = products.filter((product) => idSet.has(product._id));
  const completedCount = selectionProducts.filter(isGroupCaptureComplete).length;

  return {
    completedCount,
    total: selectionProducts.length,
  };
}

export function groupProductProgress<T extends { phase: ProductPhase }>(
  products: T[],
): GroupProductProgress {
  let pending = 0;
  let captured = 0;
  let published = 0;

  for (const product of products) {
    if (product.phase === "published") {
      published += 1;
    } else if (product.phase === "captured") {
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

export const phaseLabels: Record<ProductPhase, string> = {
  imported: "Needs photo",
  captured: "Ready to list",
  published: "On Shopify",
};

export const pendingOperationLabels: Record<PendingOperation, string> = {
  captureProcessing: "Processing photo…",
  publishing: "Publishing…",
};
