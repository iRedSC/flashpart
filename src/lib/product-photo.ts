export {
  AI_IMAGE_EDIT_STRENGTH_OPTIONS,
  AI_IMAGE_MODEL_OPTIONS,
  DEFAULT_AI_IMAGE_EDIT_STRENGTH,
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_PROMPT,
  aiImageModelShortLabel,
  type AiImageEditStrength,
  type AiImageModelId,
} from "./ai-image-settings";

import type { AiImageModelId } from "./ai-image-settings";
import { compareProductDisplayOrder } from "./product-state";

export type ProductPhotoKind = "original" | "ai";
export type ProductPhotoStatus = "uploading" | "ready" | "failed" | "promoted";

export type ProductPhoto = {
  _id: string;
  productId: string;
  kind: ProductPhotoKind;
  storageId?: string;
  url?: string;
  shopifyFileId?: string;
  shopifyFileStatus?: string;
  status: ProductPhotoStatus;
  sortOrder: number;
  sourcePhotoId?: string;
  approvedAt?: number;
  aiStatus?: "pending" | "generating" | "ready" | "failed";
  aiPrompt?: string;
  aiError?: string;
  aiModel?: AiImageModelId;
  captureId?: string;
  createdAt: number;
  updatedAt: number;
};

export type ProductPhotoPair = {
  original: ProductPhoto;
  ai: ProductPhoto | null;
  sortOrder: number;
};

type ProductPhotoFields = {
  aiImageStatus?: "pending" | "generating" | "ready" | "failed";
  aiShopifyFileUrl?: string;
  shopifyFileUrl?: string;
};

function comparePhotoSortOrder(left: ProductPhoto, right: ProductPhoto): number {
  return left.sortOrder - right.sortOrder;
}

export function listOriginals(photos: ProductPhoto[]): ProductPhoto[] {
  return photos
    .filter((photo) => photo.kind === "original")
    .sort(comparePhotoSortOrder);
}

export function listAis(photos: ProductPhoto[]): ProductPhoto[] {
  return photos
    .filter((photo) => photo.kind === "ai")
    .sort(comparePhotoSortOrder);
}

export function buildPhotoPairs(photos: ProductPhoto[]): ProductPhotoPair[] {
  const originals = listOriginals(photos);
  const ais = listAis(photos);
  const usedAiIds = new Set<string>();

  return originals.map((original) => {
    const bySource = ais.find(
      (ai) =>
        !usedAiIds.has(ai._id) && ai.sourcePhotoId === original._id,
    );

    if (bySource) {
      usedAiIds.add(bySource._id);
    }

    return {
      original,
      ai: bySource ?? null,
      sortOrder: original.sortOrder,
    };
  });
}

export function getProductThumbnailUrl(
  product: ProductPhotoFields,
  photos?: ProductPhoto[] | null,
) {
  // undefined/null = batch still loading — do not flash legacy Shopify URLs.
  if (photos == null) {
    return null;
  }

  if (photos.length > 0) {
    const ais = listAis(photos);
    const approvedAi = ais.find((photo) => photo.approvedAt != null && photo.url);
    if (approvedAi?.url) {
      return approvedAi.url;
    }

    const original = listOriginals(photos).find((photo) => photo.url);
    return original?.url ?? null;
  }

  // photos === [] — allow legacy product-level fallback.
  if (product.aiImageStatus === "ready" && product.aiShopifyFileUrl) {
    return product.aiShopifyFileUrl;
  }

  return product.shopifyFileUrl ?? null;
}

export function isAiImageGenerating(
  product: {
    aiImageStatus?: ProductPhotoFields["aiImageStatus"];
    pendingOperation?: string;
  },
  photos?: ProductPhoto[] | null,
) {
  if (photos != null && photos.length > 0) {
    // Per-row AI status only — product pendingOperation would spin all thumbs.
    // Align with dialog: pending / uploading / generating all count as in-flight.
    return listAis(photos).some(
      (photo) =>
        photo.aiStatus === "generating" ||
        photo.aiStatus === "pending" ||
        photo.status === "uploading",
    );
  }

  // No photo rows yet (loading or legacy): fall back to product fields.
  return (
    product.aiImageStatus === "generating" ||
    product.aiImageStatus === "pending" ||
    product.pendingOperation === "aiImageGenerating"
  );
}

export function isAiImageFailed(
  product: {
    aiImageStatus?: ProductPhotoFields["aiImageStatus"];
  },
  photos?: ProductPhoto[] | null,
) {
  if (photos?.length) {
    const ais = listAis(photos);
    return ais.some((photo) => {
      if (photo.aiStatus !== "failed") {
        return false;
      }

      const hasApprovedSibling = ais.some(
        (other) =>
          other._id !== photo._id &&
          other.approvedAt != null &&
          ((photo.sourcePhotoId != null &&
            other.sourcePhotoId === photo.sourcePhotoId) ||
            (photo.sourcePhotoId == null &&
              other.sourcePhotoId == null &&
              other.sortOrder === photo.sortOrder)),
      );

      return !hasApprovedSibling;
    });
  }

  return product.aiImageStatus === "failed";
}

export function needsPhotoApproval(product: {
  aiImageStatus?: ProductPhotoFields["aiImageStatus"];
  aiShopifyFileUrl?: string;
  needsPhotoReview?: boolean;
}) {
  return (
    product.needsPhotoReview === true &&
    product.aiImageStatus === "ready" &&
    Boolean(product.aiShopifyFileUrl)
  );
}

export function needsAiPhotoApproval(aiPhoto: ProductPhoto): boolean {
  return (
    aiPhoto.kind === "ai" &&
    aiPhoto.aiStatus === "ready" &&
    aiPhoto.approvedAt == null
  );
}

export function findNextPhotoNeedingApproval<
  T extends {
    _id: string;
    aiImageStatus?: ProductPhotoFields["aiImageStatus"];
    aiShopifyFileUrl?: string;
    createdAt: number;
    needsPhotoReview?: boolean;
    sortOrder?: number;
  },
>(products: T[], currentProductId: string): T | null;
export function findNextPhotoNeedingApproval<
  T extends {
    _id: string;
    aiImageStatus?: ProductPhotoFields["aiImageStatus"];
    aiShopifyFileUrl?: string;
    createdAt: number;
    needsPhotoReview?: boolean;
    sortOrder?: number;
  },
>(
  products: T[],
  currentProductId: string,
  photosByProductId: Record<string, ProductPhoto[]>,
): { product: T; aiPhoto: ProductPhoto } | null;
export function findNextPhotoNeedingApproval<
  T extends {
    _id: string;
    aiImageStatus?: ProductPhotoFields["aiImageStatus"];
    aiShopifyFileUrl?: string;
    createdAt: number;
    needsPhotoReview?: boolean;
    sortOrder?: number;
  },
>(
  products: T[],
  currentProductId: string,
  photosByProductId?: Record<string, ProductPhoto[]>,
): T | { product: T; aiPhoto: ProductPhoto } | null {
  const sorted = [...products].sort(compareProductDisplayOrder);
  const currentIndex = sorted.findIndex(
    (product) => product._id === currentProductId,
  );
  const startIndex = currentIndex === -1 ? 0 : currentIndex + 1;

  if (photosByProductId) {
    for (let index = startIndex; index < sorted.length; index += 1) {
      const product = sorted[index];
      const aiPhoto = listAis(photosByProductId[product._id] ?? []).find(
        needsAiPhotoApproval,
      );
      if (aiPhoto) {
        return { product, aiPhoto };
      }
    }

    // Wrap around so approving the last product can reach earlier ones.
    for (let index = 0; index < startIndex; index += 1) {
      const product = sorted[index];
      if (product._id === currentProductId) {
        continue;
      }
      const aiPhoto = listAis(photosByProductId[product._id] ?? []).find(
        needsAiPhotoApproval,
      );
      if (aiPhoto) {
        return { product, aiPhoto };
      }
    }

    return null;
  }

  for (let index = startIndex; index < sorted.length; index += 1) {
    if (needsPhotoApproval(sorted[index])) {
      return sorted[index];
    }
  }

  for (let index = 0; index < startIndex; index += 1) {
    if (
      sorted[index]._id !== currentProductId &&
      needsPhotoApproval(sorted[index])
    ) {
      return sorted[index];
    }
  }

  return null;
}

export function canPublishProduct(
  product: {
    aiImageStatus?: ProductPhotoFields["aiImageStatus"];
    aiShopifyFileId?: string;
    needsPhotoReview?: boolean;
    pendingOperation?: string;
    phase: "imported" | "captured" | "published";
    shopifyFileId?: string;
  },
  photos?: ProductPhoto[] | null,
) {
  return canQueueShopifyListing(product, photos, "captured");
}

/** Already-published products that still have publish-ready photos. */
export function canRepublishProduct(
  product: {
    aiImageStatus?: ProductPhotoFields["aiImageStatus"];
    aiShopifyFileId?: string;
    needsPhotoReview?: boolean;
    pendingOperation?: string;
    phase: "imported" | "captured" | "published";
    shopifyFileId?: string;
    shopifyProductId?: string | null;
  },
  photos?: ProductPhoto[] | null,
) {
  const isPublished =
    product.phase === "published" || Boolean(product.shopifyProductId);

  if (!isPublished) {
    return false;
  }

  return canQueueShopifyListing(
    {
      ...product,
      phase: "published",
    },
    photos,
    "published",
  );
}

function canQueueShopifyListing(
  product: {
    aiImageStatus?: ProductPhotoFields["aiImageStatus"];
    aiShopifyFileId?: string;
    needsPhotoReview?: boolean;
    pendingOperation?: string;
    phase: "imported" | "captured" | "published";
    shopifyFileId?: string;
  },
  photos: ProductPhoto[] | null | undefined,
  requiredPhase: "captured" | "published",
) {
  // undefined/null = batch still loading — do not treat as publishable yet.
  if (photos == null) {
    return false;
  }

  if (photos.length > 0) {
    const pairs = buildPhotoPairs(photos);
    // Match listingJobs gate: every original → paired AI with ready + approvedAt.
    // Shopify promote failures (shopifyFileStatus) are retryable and must not
    // block Publish — only AI/status generation failures do.
    const everyOriginalHasApprovedReadyAi =
      pairs.length >= 1 &&
      pairs.every(
        (pair) =>
          pair.ai != null &&
          pair.ai.aiStatus === "ready" &&
          pair.ai.approvedAt != null &&
          pair.ai.status !== "failed" &&
          pair.original.status !== "failed",
      );

    return (
      product.phase === requiredPhase &&
      everyOriginalHasApprovedReadyAi &&
      !product.pendingOperation
    );
  }

  // photos === [] — legacy product-level fields.
  return (
    product.phase === requiredPhase &&
    Boolean(product.shopifyFileId) &&
    product.aiImageStatus === "ready" &&
    Boolean(product.aiShopifyFileId) &&
    !product.needsPhotoReview &&
    !product.pendingOperation
  );
}
