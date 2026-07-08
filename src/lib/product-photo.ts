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

type ProductPhotoFields = {
  aiImageStatus?: "pending" | "generating" | "ready" | "failed";
  aiShopifyFileUrl?: string;
  shopifyFileUrl?: string;
};

export function getProductThumbnailUrl(product: ProductPhotoFields) {
  if (product.aiImageStatus === "ready" && product.aiShopifyFileUrl) {
    return product.aiShopifyFileUrl;
  }

  return product.shopifyFileUrl ?? null;
}

export function isAiImageGenerating(product: {
  aiImageStatus?: ProductPhotoFields["aiImageStatus"];
  pendingOperation?: string;
}) {
  return (
    product.aiImageStatus === "generating" ||
    product.pendingOperation === "aiImageGenerating"
  );
}

export function isAiImageFailed(product: {
  aiImageStatus?: ProductPhotoFields["aiImageStatus"];
}) {
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

export function findNextPhotoNeedingApproval<
  T extends {
    _id: string;
    aiImageStatus?: ProductPhotoFields["aiImageStatus"];
    aiShopifyFileUrl?: string;
    createdAt: number;
    needsPhotoReview?: boolean;
    sortOrder?: number;
  },
>(products: T[], currentProductId: string) {
  const sorted = [...products].sort(compareProductDisplayOrder);
  const currentIndex = sorted.findIndex((product) => product._id === currentProductId);
  const startIndex = currentIndex === -1 ? 0 : currentIndex + 1;

  for (let index = startIndex; index < sorted.length; index += 1) {
    if (needsPhotoApproval(sorted[index])) {
      return sorted[index];
    }
  }

  return null;
}

export function canPublishProduct(product: {
  aiImageStatus?: ProductPhotoFields["aiImageStatus"];
  aiShopifyFileId?: string;
  needsPhotoReview?: boolean;
  pendingOperation?: string;
  phase: "imported" | "captured" | "published";
  shopifyFileId?: string;
}) {
  return (
    product.phase === "captured" &&
    Boolean(product.shopifyFileId) &&
    product.aiImageStatus === "ready" &&
    Boolean(product.aiShopifyFileId) &&
    !product.needsPhotoReview &&
    !product.pendingOperation
  );
}
