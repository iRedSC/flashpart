export type ProductPhase = "imported" | "captured" | "published";

export type PendingOperation =
  | "captureProcessing"
  | "aiImageGenerating"
  | "publishing";

export type ProductErrorCode =
  | "duplicateSku"
  | "shopifyApi"
  | "captureUpload"
  | "aiImageGeneration"
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
  aiImageStatus?: "pending" | "generating" | "ready" | "failed";
  aiShopifyFileId?: string;
};

/** Minimal photo shape for dual-read helpers (avoids importing product-photo). */
export type ProductPhotoCaptureFields = {
  kind: "original" | "ai";
  approvedAt?: number;
  aiStatus?: "pending" | "generating" | "ready" | "failed";
};

export type GroupProductProgress = {
  pending: number;
  captured: number;
  published: number;
  archived: number;
  total: number;
};

export function countOriginalPhotos(
  photos?: ProductPhotoCaptureFields[] | null,
): number {
  if (photos == null) {
    return 0;
  }

  return photos.filter((photo) => photo.kind === "original").length;
}

export function hasCapturedPhoto(
  product: { shopifyFileId?: string },
  photos?: ProductPhotoCaptureFields[] | null,
): boolean {
  const hasOriginal = countOriginalPhotos(photos) > 0;
  return hasOriginal || Boolean(product.shopifyFileId);
}

/**
 * Pending capture for queue / re-entry.
 * With photo rows + maxProductPhotos: still pending while originalCount < max.
 * With photo rows but no max: any original (or legacy shopifyFileId) completes.
 * Without photo rows: phase === "imported".
 */
export function isPendingCapture(
  product: { phase: ProductPhase; shopifyFileId?: string },
  photos?: ProductPhotoCaptureFields[] | null,
  maxProductPhotos?: number,
): boolean {
  if (photos != null) {
    if (maxProductPhotos != null) {
      const originalCount = countOriginalPhotos(photos);
      if (originalCount > 0) {
        return originalCount < maxProductPhotos;
      }

      // No originals: skip-without-photo / legacy — phase + shopifyFileId.
      return (
        product.phase === "imported" && !hasCapturedPhoto(product, photos)
      );
    }

    return !hasCapturedPhoto(product, photos);
  }

  return product.phase === "imported";
}

/** Capture progress complete: at max originals, or legacy captured/published. */
export function isGroupCaptureComplete(
  product: { phase: ProductPhase; shopifyFileId?: string },
  photos?: ProductPhotoCaptureFields[] | null,
  maxProductPhotos?: number,
): boolean {
  if (photos != null && maxProductPhotos != null) {
    const originalCount = countOriginalPhotos(photos);
    if (originalCount > 0) {
      return originalCount >= maxProductPhotos;
    }

    return (
      product.phase === "captured" ||
      product.phase === "published" ||
      Boolean(product.shopifyFileId)
    );
  }

  return product.phase === "captured" || product.phase === "published";
}

export function isPublishable(
  product: ProductStateFields,
  photos?: ProductPhotoCaptureFields[] | null,
): boolean {
  if (photos?.length) {
    const originals = photos.filter((photo) => photo.kind === "original");
    const ais = photos.filter((photo) => photo.kind === "ai");
    const hasGeneratingAi = ais.some(
      (photo) => photo.aiStatus === "generating",
    );
    const allAisApproved =
      ais.length >= 1 && ais.every((photo) => photo.approvedAt != null);

    return (
      product.phase === "captured" &&
      originals.length >= 1 &&
      allAisApproved &&
      !hasGeneratingAi &&
      !product.pendingOperation
    );
  }

  return (
    product.phase === "captured" &&
    Boolean(product.shopifyFileId) &&
    product.aiImageStatus === "ready" &&
    Boolean(product.aiShopifyFileId) &&
    !product.needsPhotoReview &&
    !product.pendingOperation
  );
}

export function hasActiveError(product: { lastError?: LastError }): boolean {
  return product.lastError !== undefined;
}

export function isArchived(product: { archivedAt?: number }): boolean {
  return product.archivedAt !== undefined;
}

export function canArchive(product: { lastError?: LastError }): boolean {
  return !hasActiveError(product);
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
    _id: string;
    phase: ProductPhase;
    groupId?: string;
    archivedAt?: number;
    sortOrder?: number;
    createdAt: number;
    shopifyFileId?: string;
  },
>(
  products: T[],
  groupId: string,
  photosByProductId?: Record<string, ProductPhotoCaptureFields[]>,
  maxProductPhotos?: number,
  excludeProductIds?: Iterable<string>,
): T | null {
  const excludeSet =
    excludeProductIds == null ? null : new Set(excludeProductIds);

  return (
    products
      .filter(
        (product) =>
          product.groupId === groupId &&
          !isArchived(product) &&
          !excludeSet?.has(product._id),
      )
      .sort(compareProductDisplayOrder)
      .find((product) =>
        photosByProductId
          ? isPendingCapture(
              product,
              photosByProductId[product._id] ?? [],
              maxProductPhotos,
            )
          : isPendingCapture(product),
      ) ?? null
  );
}

export function nextUncapturedSelectionProduct<
  T extends {
    _id: string;
    phase: ProductPhase;
    archivedAt?: number;
    sortOrder?: number;
    createdAt: number;
    shopifyFileId?: string;
  },
>(
  products: T[],
  productIds: string[],
  photosByProductId?: Record<string, ProductPhotoCaptureFields[]>,
  maxProductPhotos?: number,
  excludeProductIds?: Iterable<string>,
): T | null {
  const idSet = new Set(productIds);
  const excludeSet =
    excludeProductIds == null ? null : new Set(excludeProductIds);

  return (
    products
      .filter(
        (product) =>
          idSet.has(product._id) &&
          !isArchived(product) &&
          !excludeSet?.has(product._id),
      )
      .sort(compareProductDisplayOrder)
      .find((product) =>
        photosByProductId
          ? isPendingCapture(
              product,
              photosByProductId[product._id] ?? [],
              maxProductPhotos,
            )
          : isPendingCapture(product),
      ) ?? null
  );
}

export function selectionCaptureProgress<
  T extends {
    _id: string;
    phase: ProductPhase;
    archivedAt?: number;
    shopifyFileId?: string;
  },
>(
  products: T[],
  productIds: string[],
  photosByProductId?: Record<string, ProductPhotoCaptureFields[]>,
  maxProductPhotos?: number,
) {
  const idSet = new Set(productIds);
  const selectionProducts = products.filter(
    (product) => idSet.has(product._id) && !isArchived(product),
  );
  const completedCount = selectionProducts.filter((product) =>
    photosByProductId
      ? isGroupCaptureComplete(
          product,
          photosByProductId[product._id] ?? [],
          maxProductPhotos,
        )
      : isGroupCaptureComplete(product),
  ).length;

  return {
    completedCount,
    total: selectionProducts.length,
  };
}

export function groupProductProgress<
  T extends { phase: ProductPhase; archivedAt?: number },
>(products: T[]): GroupProductProgress {
  let pending = 0;
  let captured = 0;
  let published = 0;
  let archived = 0;

  for (const product of products) {
    if (isArchived(product)) {
      archived += 1;
      continue;
    }

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
    archived,
    total: pending + captured + published + archived,
  };
}

export function isGroupArchived(group: { archivedAt?: number }): boolean {
  return group.archivedAt !== undefined;
}

export function allGroupProductsArchived<
  T extends { archivedAt?: number },
>(products: T[]): boolean {
  return products.length > 0 && products.every(isArchived);
}

export const phaseLabels: Record<ProductPhase, string> = {
  imported: "Needs photo",
  captured: "Ready to list",
  published: "On Shopify",
};

export const pendingOperationLabels: Record<PendingOperation, string> = {
  aiImageGenerating: "Generating AI photo…",
  captureProcessing: "Processing photo…",
  publishing: "Publishing…",
};
