export {
  AI_IMAGE_MODEL_OPTIONS,
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_PROMPT,
  type AiImageModelId,
} from "./ai-image-settings";

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
