import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireSessionUser } from "./authUtils";
import {
  buildAiGenerationRequest,
  GEMINI_IMAGE_MODEL,
  imageSizeForModel,
  isAiImageEditStrength,
  isAiImageModel,
} from "./photoAiConstants";
import { maybeUnarchiveGroupForActiveProduct } from "./groups";
import { applyApproveAiPhoto } from "./productPhotos";
import { productErrorFields } from "./productState";
import { resolveAiImageSettings } from "./settings";
import {
  deleteShopifyFiles,
  uploadImageBufferToShopify,
} from "./shopifyClient";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const photoAiModel = {
  markGenerating: makeFunctionReference("photoAi.js:markGenerating") as any,
  markReady: makeFunctionReference("photoAi.js:markReady") as any,
  markFailed: makeFunctionReference("photoAi.js:markFailed") as any,
  processingPayload: makeFunctionReference(
    "photoAi.js:processingPayload",
  ) as any,
  processProductPhoto: makeFunctionReference(
    "photoAi.js:processProductPhoto",
  ) as any,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const productPhotosModel = {
  markAiGeneratingInternal: makeFunctionReference(
    "productPhotos.js:markAiGeneratingInternal",
  ) as any,
  markAiReadyInternal: makeFunctionReference(
    "productPhotos.js:markAiReadyInternal",
  ) as any,
  markAiFailedInternal: makeFunctionReference(
    "productPhotos.js:markAiFailedInternal",
  ) as any,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shopifyModel = {
  firstActiveConnection: makeFunctionReference(
    "shopifyModel.js:firstActiveConnection",
  ) as any,
};

type GeminiPart = {
  inlineData?: { data?: string; mimeType?: string };
  inline_data?: { data?: string; mime_type?: string };
  text?: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  error?: { message?: string };
};

function assertGeminiEnv() {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new ConvexError(
      "Missing Convex env var GOOGLE_GEMINI_API_KEY for AI photo generation.",
    );
  }

  return apiKey;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

async function generateEditedImage(input: {
  editStrength: string;
  imageData: ArrayBuffer;
  mimeType: string;
  model: string;
  prompt: string;
}) {
  const apiKey = assertGeminiEnv();
  const model = isAiImageModel(input.model) ? input.model : GEMINI_IMAGE_MODEL;
  const editStrength = isAiImageEditStrength(input.editStrength)
    ? input.editStrength
    : "balanced";
  const generation = buildAiGenerationRequest(input.prompt, editStrength);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  data: arrayBufferToBase64(input.imageData),
                  mime_type: input.mimeType,
                },
              },
              { text: generation.prompt },
            ],
          },
        ],
        generationConfig: {
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: imageSizeForModel(model),
          },
          responseModalities: ["TEXT", "IMAGE"],
          temperature: generation.temperature,
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new ConvexError(
      `Gemini image generation failed (${response.status}): ${errorText.slice(0, 240)}`,
    );
  }

  const result = (await response.json()) as GeminiResponse;

  if (result.error?.message) {
    throw new ConvexError(result.error.message);
  }

  const parts = result.candidates?.[0]?.content?.parts ?? [];

  for (const part of parts) {
    const inlineData = part.inlineData ?? part.inline_data;

    if (inlineData?.data) {
      const mimeType =
        "mimeType" in inlineData && inlineData.mimeType
          ? inlineData.mimeType
          : "mime_type" in inlineData
            ? inlineData.mime_type
            : undefined;

      return {
        data: base64ToArrayBuffer(inlineData.data),
        mimeType: mimeType ?? "image/png",
      };
    }
  }

  throw new ConvexError("Gemini did not return an edited image.");
}

export const processingPayload = internalQuery({
  args: {
    productId: v.id("products"),
    originalPhotoId: v.optional(v.id("productPhotos")),
  },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);

    if (!product) {
      return null;
    }

    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const aiSettings = resolveAiImageSettings(settings);

    if (args.originalPhotoId) {
      const original = await ctx.db.get(args.originalPhotoId);

      if (
        !original ||
        original.productId !== args.productId ||
        original.kind !== "original"
      ) {
        return null;
      }

      if (!original.storageId && !original.url) {
        return null;
      }

      const existingAi = await ctx.db
        .query("productPhotos")
        .withIndex("by_source", (q) =>
          q.eq("sourcePhotoId", args.originalPhotoId!),
        )
        .unique();

      return {
        mode: "convex" as const,
        aiImageEditStrength: aiSettings.aiImageEditStrength,
        aiImageModel: aiSettings.aiImageModel,
        aiImagePrompt:
          existingAi?.aiPrompt ??
          product.aiImagePrompt ??
          aiSettings.aiImageDefaultPrompt,
        originalPhotoId: original._id,
        originalStorageId: original.storageId,
        originalUrl: original.url,
        productId: product._id,
        sku: product.sku,
      };
    }

    if (!product.shopifyFileUrl || !product.shopifyFileId) {
      return null;
    }

    return {
      mode: "shopify" as const,
      aiImageEditStrength: aiSettings.aiImageEditStrength,
      aiImageModel: aiSettings.aiImageModel,
      aiImagePrompt:
        product.aiImagePrompt ?? aiSettings.aiImageDefaultPrompt,
      aiShopifyFileId: product.aiShopifyFileId,
      productId: product._id,
      shopifyFileUrl: product.shopifyFileUrl,
      sku: product.sku,
    };
  },
});

export const markGenerating = internalMutation({
  args: {
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    await ctx.db.patch(args.productId, {
      aiImageError: undefined,
      aiImageStatus: "generating",
      lastError: undefined,
      pendingOperation: "aiImageGenerating",
      updatedAt: now,
    });
  },
});

export const markReady = internalMutation({
  args: {
    aiShopifyFileId: v.string(),
    aiShopifyFileStatus: v.union(
      v.literal("uploaded"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    aiShopifyFileUrl: v.optional(v.string()),
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    await ctx.db.patch(args.productId, {
      aiImageError: undefined,
      aiImageStatus: "ready",
      aiShopifyFileId: args.aiShopifyFileId,
      aiShopifyFileStatus: args.aiShopifyFileStatus,
      aiShopifyFileUrl: args.aiShopifyFileUrl,
      needsPhotoReview: true,
      pendingOperation: undefined,
      updatedAt: now,
    });
  },
});

export const markFailed = internalMutation({
  args: {
    error: v.string(),
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const product = await ctx.db.get(args.productId);

    await ctx.db.patch(args.productId, {
      aiImageError: args.error,
      aiImageStatus: "failed",
      ...productErrorFields(
        {
          at: now,
          code: "aiImageGeneration",
          message: args.error,
          operation: "aiImageGenerating",
        },
        now,
      ),
    });
    await maybeUnarchiveGroupForActiveProduct(ctx, product?.groupId, now);
  },
});

export const scheduleProcessing = internalMutation({
  args: {
    productId: v.id("products"),
    resetPrompt: v.optional(v.boolean()),
    originalPhotoId: v.optional(v.id("productPhotos")),
  },
  handler: async (ctx, args) => {
    if (args.originalPhotoId) {
      const original = await ctx.db.get(args.originalPhotoId);

      if (
        !original ||
        original.productId !== args.productId ||
        original.kind !== "original"
      ) {
        return;
      }

      await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
        productId: args.productId,
        originalPhotoId: args.originalPhotoId,
      });
      return;
    }

    const product = await ctx.db.get(args.productId);

    if (!product?.shopifyFileId || !product.shopifyFileUrl) {
      return;
    }

    const now = Date.now();
    const patch: Record<string, unknown> = {
      aiImageError: undefined,
      aiImageStatus: "generating",
      lastError: undefined,
      needsPhotoReview: undefined,
      pendingOperation: "aiImageGenerating",
      updatedAt: now,
    };

    if (args.resetPrompt) {
      const settings = await ctx.db
        .query("appSettings")
        .withIndex("by_key", (q) => q.eq("key", "singleton"))
        .unique();
      patch.aiImagePrompt = resolveAiImageSettings(settings).aiImageDefaultPrompt;
      patch.aiShopifyFileId = undefined;
      patch.aiShopifyFileStatus = undefined;
      patch.aiShopifyFileUrl = undefined;
    }

    await ctx.db.patch(args.productId, patch);
    await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
      productId: args.productId,
      previousAiShopifyFileId: args.resetPrompt
        ? product.aiShopifyFileId
        : undefined,
    });
  },
});

export const processProductPhoto = internalAction({
  args: {
    previousAiShopifyFileId: v.optional(v.string()),
    productId: v.id("products"),
    originalPhotoId: v.optional(v.id("productPhotos")),
  },
  handler: async (ctx, args) => {
    if (args.originalPhotoId) {
      await ctx.runMutation(productPhotosModel.markAiGeneratingInternal, {
        productId: args.productId,
        originalPhotoId: args.originalPhotoId,
      });

      try {
        const payload = await ctx.runQuery(photoAiModel.processingPayload, {
          productId: args.productId,
          originalPhotoId: args.originalPhotoId,
        });

        if (!payload || payload.mode !== "convex") {
          throw new ConvexError("Original product photo is missing image data.");
        }

        let originalData: ArrayBuffer;
        let originalMimeType = "image/jpeg";

        if (payload.originalStorageId) {
          const blob = await ctx.storage.get(
            payload.originalStorageId as Id<"_storage">,
          );

          if (!blob) {
            throw new ConvexError("Could not load the original product photo.");
          }

          originalMimeType = blob.type || "image/jpeg";
          originalData = await blob.arrayBuffer();
        } else if (payload.originalUrl) {
          const originalResponse = await fetch(payload.originalUrl);

          if (!originalResponse.ok) {
            throw new ConvexError("Could not download the original product photo.");
          }

          originalMimeType =
            originalResponse.headers.get("content-type") ?? "image/jpeg";
          originalData = await originalResponse.arrayBuffer();
        } else {
          throw new ConvexError("Original product photo is missing image data.");
        }

        const generated = await generateEditedImage({
          editStrength: payload.aiImageEditStrength,
          imageData: originalData,
          mimeType: originalMimeType,
          model: payload.aiImageModel,
          prompt: payload.aiImagePrompt,
        });
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array(generated.data)], {
            type: generated.mimeType,
          }),
        );
        const url = await ctx.storage.getUrl(storageId);

        await ctx.runMutation(productPhotosModel.markAiReadyInternal, {
          originalPhotoId: args.originalPhotoId,
          storageId,
          url: url ?? undefined,
        });
      } catch (error) {
        await ctx.runMutation(productPhotosModel.markAiFailedInternal, {
          error:
            error instanceof Error
              ? error.message
              : "AI photo generation failed.",
          originalPhotoId: args.originalPhotoId,
        });
      }

      return;
    }

    await ctx.runMutation(photoAiModel.markGenerating, {
      productId: args.productId,
    });

    try {
      const [payload, connection] = await Promise.all([
        ctx.runQuery(photoAiModel.processingPayload, {
          productId: args.productId,
        }),
        ctx.runQuery(shopifyModel.firstActiveConnection, {}),
      ]);

      if (!payload || payload.mode !== "shopify") {
        throw new ConvexError("Product is missing an original Shopify photo.");
      }

      if (!connection) {
        throw new ConvexError("Connect Shopify before generating AI photos.");
      }

      if (args.previousAiShopifyFileId) {
        await deleteShopifyFiles(connection, [args.previousAiShopifyFileId]).catch(
          () => undefined,
        );
      }

      const originalResponse = await fetch(payload.shopifyFileUrl);

      if (!originalResponse.ok) {
        throw new ConvexError("Could not download the original product photo.");
      }

      const originalMimeType =
        originalResponse.headers.get("content-type") ?? "image/jpeg";
      const originalData = await originalResponse.arrayBuffer();
      const generated = await generateEditedImage({
        editStrength: payload.aiImageEditStrength,
        imageData: originalData,
        mimeType: originalMimeType,
        model: payload.aiImageModel,
        prompt: payload.aiImagePrompt,
      });
      const extension = generated.mimeType.includes("png") ? "png" : "jpg";
      const aiFile = await uploadImageBufferToShopify(connection, {
        alt: `${payload.sku} AI photo`,
        data: generated.data,
        filename: `${payload.sku}-ai.${extension}`,
        mimeType: generated.mimeType,
      });

      await ctx.runMutation(photoAiModel.markReady, {
        aiShopifyFileId: aiFile.id,
        aiShopifyFileStatus: aiFile.status,
        aiShopifyFileUrl: aiFile.url,
        productId: args.productId,
      });
    } catch (error) {
      await ctx.runMutation(photoAiModel.markFailed, {
        error:
          error instanceof Error
            ? error.message
            : "AI photo generation failed.",
        productId: args.productId,
      });
    }
  },
});

export const regenerate = mutation({
  args: {
    productId: v.id("products"),
    prompt: v.string(),
    sessionToken: v.string(),
    originalPhotoId: v.optional(v.id("productPhotos")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const product = await ctx.db.get(args.productId);
    const prompt = args.prompt.trim();

    if (!product) {
      throw new ConvexError("Product not found.");
    }

    if (!prompt) {
      throw new ConvexError("Enter a prompt before regenerating.");
    }

    if (args.originalPhotoId) {
      const original = await ctx.db.get(args.originalPhotoId);

      if (
        !original ||
        original.productId !== args.productId ||
        original.kind !== "original"
      ) {
        throw new ConvexError("Original photo not found.");
      }

      if (!original.storageId && !original.url) {
        throw new ConvexError("Capture a product photo before regenerating.");
      }

      const now = Date.now();
      const existingAi = await ctx.db
        .query("productPhotos")
        .withIndex("by_source", (q) =>
          q.eq("sourcePhotoId", args.originalPhotoId!),
        )
        .unique();

      if (existingAi) {
        await ctx.db.patch(existingAi._id, {
          aiError: undefined,
          aiPrompt: prompt,
          aiStatus: "generating",
          approvedAt: undefined,
          sortOrder: original.sortOrder,
          status: "uploading",
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("productPhotos", {
          productId: args.productId,
          kind: "ai",
          status: "uploading",
          sortOrder: original.sortOrder,
          sourcePhotoId: args.originalPhotoId,
          aiStatus: "generating",
          aiPrompt: prompt,
          createdAt: now,
          updatedAt: now,
        });
      }

      await ctx.db.patch(args.productId, {
        aiImagePrompt: prompt,
        needsPhotoReview: undefined,
        pendingOperation: "aiImageGenerating",
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
        productId: args.productId,
        originalPhotoId: args.originalPhotoId,
      });
      return;
    }

    const photoRows = await ctx.db
      .query("productPhotos")
      .withIndex("by_product", (q) => q.eq("productId", args.productId))
      .collect();

    if (photoRows.length > 0) {
      throw new ConvexError(
        "Specify originalPhotoId to regenerate AI for a multi-photo product.",
      );
    }

    if (!product.shopifyFileId || !product.shopifyFileUrl) {
      throw new ConvexError("Capture a product photo before regenerating.");
    }

    const now = Date.now();
    const previousAiShopifyFileId = product.aiShopifyFileId;

    await ctx.db.patch(args.productId, {
      aiImageError: undefined,
      aiImagePrompt: prompt,
      aiImageStatus: "generating",
      lastError: undefined,
      needsPhotoReview: undefined,
      pendingOperation: "aiImageGenerating",
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
      previousAiShopifyFileId,
      productId: args.productId,
    });
  },
});

export const regenerateForPhoto = mutation({
  args: {
    sessionToken: v.string(),
    originalPhotoId: v.id("productPhotos"),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const original = await ctx.db.get(args.originalPhotoId);

    if (!original || original.kind !== "original") {
      throw new ConvexError("Original photo not found.");
    }

    if (!original.storageId && !original.url) {
      throw new ConvexError("Capture a product photo before regenerating.");
    }

    const product = await ctx.db.get(original.productId);

    if (!product) {
      throw new ConvexError("Product not found.");
    }

    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const defaultPrompt = resolveAiImageSettings(settings).aiImageDefaultPrompt;
    const prompt = args.prompt?.trim() || product.aiImagePrompt || defaultPrompt;
    const now = Date.now();
    const existingAi = await ctx.db
      .query("productPhotos")
      .withIndex("by_source", (q) => q.eq("sourcePhotoId", args.originalPhotoId))
      .unique();

    if (existingAi) {
      await ctx.db.patch(existingAi._id, {
        aiError: undefined,
        aiPrompt: prompt,
        aiStatus: "generating",
        approvedAt: undefined,
        sortOrder: original.sortOrder,
        status: "uploading",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("productPhotos", {
        productId: original.productId,
        kind: "ai",
        status: "uploading",
        sortOrder: original.sortOrder,
        sourcePhotoId: args.originalPhotoId,
        aiStatus: "generating",
        aiPrompt: prompt,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(original.productId, {
      aiImagePrompt: prompt,
      needsPhotoReview: undefined,
      pendingOperation: "aiImageGenerating",
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, photoAiModel.processProductPhoto, {
      productId: original.productId,
      originalPhotoId: args.originalPhotoId,
    });
  },
});

export const approveAiPhoto = mutation({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    await applyApproveAiPhoto(ctx, args.photoId);
  },
});

export const approvePhoto = mutation({
  args: {
    productId: v.id("products"),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const product = await ctx.db.get(args.productId);

    if (!product) {
      throw new ConvexError("Product not found.");
    }

    if (product.aiImageStatus !== "ready") {
      throw new ConvexError("Approve the AI photo after generation finishes.");
    }

    await ctx.db.patch(args.productId, {
      needsPhotoReview: undefined,
      updatedAt: Date.now(),
    });
  },
});
