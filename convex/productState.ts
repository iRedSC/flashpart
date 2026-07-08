import { v } from "convex/values";

export const productPhase = v.union(
  v.literal("imported"),
  v.literal("captured"),
  v.literal("published"),
);

export const pendingOperation = v.union(
  v.literal("captureProcessing"),
  v.literal("aiImageGenerating"),
  v.literal("publishing"),
);

export const aiImageStatus = v.union(
  v.literal("pending"),
  v.literal("generating"),
  v.literal("ready"),
  v.literal("failed"),
);

export const productErrorCode = v.union(
  v.literal("duplicateSku"),
  v.literal("shopifyApi"),
  v.literal("captureUpload"),
  v.literal("aiImageGeneration"),
  v.literal("unknown"),
);

export const lastError = v.object({
  code: productErrorCode,
  message: v.string(),
  operation: v.optional(pendingOperation),
  at: v.number(),
});

export const captureStatus = v.union(
  v.literal("recorded"),
  v.literal("fileProcessing"),
  v.literal("ready"),
  v.literal("failed"),
);

export type ProductPhase = "imported" | "captured" | "published";
export type PendingOperation =
  | "captureProcessing"
  | "aiImageGenerating"
  | "publishing";
export type AiImageStatus = "pending" | "generating" | "ready" | "failed";
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

type LegacyStatus =
  | "imported"
  | "grouped"
  | "captured"
  | "processing"
  | "draftCreated"
  | "published"
  | "failed"
  | "blockedExistingSku"
  | "needsReview";

type LegacyProduct = {
  status?: LegacyStatus;
  phase?: ProductPhase;
  shopifyFileId?: string;
  shopifyProductId?: string;
  shopifyFileStatus?: "uploaded" | "processing" | "ready" | "failed";
  error?: string;
  lastError?: LastError;
  updatedAt: number;
};

export function resolveProductPhase(product: LegacyProduct): ProductPhase {
  if (product.phase) {
    return product.phase;
  }

  const patch = migrateLegacyProduct(product);
  return patch?.phase ?? inferPhase(product);
}

export function inferPhase(product: {
  shopifyProductId?: string;
  shopifyFileId?: string;
}): ProductPhase {
  if (product.shopifyProductId) {
    return "published";
  }

  if (product.shopifyFileId) {
    return "captured";
  }

  return "imported";
}

export function migrateLegacyProduct(product: LegacyProduct) {
  if (product.phase) {
    return null;
  }

  const status = product.status ?? "imported";
  let phase: ProductPhase = "imported";
  let pendingOperation: PendingOperation | undefined;
  let needsPhotoReview = false;
  let lastError: LastError | undefined;

  switch (status) {
    case "imported":
    case "grouped":
      phase = "imported";
      break;
    case "captured":
      phase = "captured";
      break;
    case "published":
    case "draftCreated":
      phase = "published";
      break;
    case "processing":
      phase = product.shopifyFileId ? "captured" : "imported";
      pendingOperation =
        product.shopifyFileStatus === "processing"
          ? "captureProcessing"
          : "publishing";
      break;
    case "needsReview":
      phase = "captured";
      needsPhotoReview = true;
      break;
    case "failed":
    case "blockedExistingSku":
      phase = inferPhase(product);
      lastError = {
        code: status === "blockedExistingSku" ? "duplicateSku" : "unknown",
        message:
          product.error ??
          (status === "blockedExistingSku"
            ? "A Shopify product with this SKU already exists."
            : "The last operation failed."),
        operation: "publishing",
        at: product.updatedAt,
      };
      break;
    default:
      phase = inferPhase(product);
  }

  if (product.error && !lastError) {
    lastError = {
      code: "unknown",
      message: product.error,
      operation: "publishing",
      at: product.updatedAt,
    };
  }

  return {
    phase,
    pendingOperation,
    needsPhotoReview,
    lastError,
  };
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

export function isPendingCapture(product: { phase: ProductPhase }): boolean {
  return product.phase === "imported";
}

export function isGroupCaptureComplete(product: { phase: ProductPhase }): boolean {
  return product.phase === "captured" || product.phase === "published";
}
