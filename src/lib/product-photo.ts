export {
  AI_IMAGE_EDIT_STRENGTH_OPTIONS,
  AI_IMAGE_MODEL_OPTIONS,
  DEFAULT_AI_IMAGE_EDIT_STRENGTH,
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_PROMPT,
  type AiImageEditStrength,
  type AiImageModelId,
} from "./ai-image-settings";

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
    const bySortOrder =
      bySource ??
      ais.find(
        (ai) =>
          !usedAiIds.has(ai._id) &&
          ai.sourcePhotoId == null &&
          ai.sortOrder === original.sortOrder,
      );

    if (bySortOrder) {
      usedAiIds.add(bySortOrder._id);
    }

    return {
      original,
      ai: bySortOrder ?? null,
      sortOrder: original.sortOrder,
    };
  });
}

export function getProductThumbnailUrl(
  product: ProductPhotoFields,
  photos?: ProductPhoto[] | null,
) {
  if (photos?.length) {
    const ais = listAis(photos);
    const approvedAi = ais.find((photo) => photo.approvedAt != null && photo.url);
    if (approvedAi?.url) {
      return approvedAi.url;
    }

    const readyAi = ais.find(
      (photo) => photo.aiStatus === "ready" && photo.url,
    );
    if (readyAi?.url) {
      return readyAi.url;
    }

    const original = listOriginals(photos).find((photo) => photo.url);
    return original?.url ?? null;
  }

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
  if (photos?.length) {
    return (
      listAis(photos).some((photo) => photo.aiStatus === "generating") ||
      product.pendingOperation === "aiImageGenerating"
    );
  }

  return (
    product.aiImageStatus === "generating" ||
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

    return null;
  }

  for (let index = startIndex; index < sorted.length; index += 1) {
    if (needsPhotoApproval(sorted[index])) {
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
  if (photos?.length) {
    const originals = listOriginals(photos);
    const ais = listAis(photos);
    const hasGeneratingAi = ais.some(
      (photo) => photo.aiStatus === "generating",
    );
    // Match listingJobs gate: every AI row must be approved (delete unwanted pairs).
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
