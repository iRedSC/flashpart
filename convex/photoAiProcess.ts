"use node";

import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  aiImageModel,
  buildAiGenerationRequest,
  GEMINI_IMAGE_MODEL,
  imageSizeForModel,
  isAiImageEditStrength,
  isAiImageModel,
} from "./photoAiConstants";
import {
  deleteShopifyFiles,
  uploadImageBufferToShopify,
} from "./shopifyClient";
import { whitenOffWhiteBackground } from "./whitenBackground";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const photoAiModel = {
  markGenerating: makeFunctionReference("photoAi.js:markGenerating") as any,
  markReady: makeFunctionReference("photoAi.js:markReady") as any,
  markFailed: makeFunctionReference("photoAi.js:markFailed") as any,
  processingPayload: makeFunctionReference(
    "photoAi.js:processingPayload",
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
  detachAndDeleteShopifyFiles: makeFunctionReference(
    "shopify.js:detachAndDeleteShopifyFiles",
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

type ShopifyConnection = {
  accessToken: string;
  shopDomain: string;
};

/** Delete Shopify Files; treat already-gone as success (same as deleteProductPhoto). */
async function deleteShopifyFilesBestEffort(
  connection: ShopifyConnection,
  fileIds: string[],
) {
  const unique = [...new Set(fileIds.filter(Boolean))];
  if (unique.length === 0) {
    return;
  }

  try {
    await deleteShopifyFiles(connection, unique);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const alreadyGone =
      /not found|does not exist|FILE_DOES_NOT_EXIST|already deleted/i.test(
        message,
      );
    if (!alreadyGone) {
      // Best-effort cleanup: do not fail AI generation on Shopify delete errors.
      console.error("Failed to delete previous Shopify files:", message);
    }
  }
}

/**
 * Detach Files from a published product gallery (when known), then delete.
 * Falls back to bare fileDelete when there is no Shopify product id yet.
 */
async function detachAndDeleteShopifyFilesBestEffort(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: { runAction: (...args: any[]) => Promise<unknown> },
  connection: ShopifyConnection,
  fileIds: string[],
  shopifyProductId?: string | null,
) {
  const unique = [...new Set(fileIds.filter(Boolean))];
  if (unique.length === 0) {
    return;
  }

  if (shopifyProductId) {
    try {
      await ctx.runAction(shopifyModel.detachAndDeleteShopifyFiles, {
        fileIds: unique,
        shopifyProductId,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        "Failed to detach/delete previous Shopify files:",
        message,
      );
      // Fall through to bare delete as a second best-effort.
    }
  }

  await deleteShopifyFilesBestEffort(connection, unique);
}

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
  return Buffer.from(buffer).toString("base64");
}

function base64ToArrayBuffer(base64: string) {
  const buffer = Buffer.from(base64, "base64");
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
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

export const processProductPhoto = internalAction({
  args: {
    previousAiShopifyFileId: v.optional(v.string()),
    /** Cleared Shopify file ids from regen/replace (multi-photo path). */
    previousShopifyFileIds: v.optional(v.array(v.string())),
    productId: v.id("products"),
    originalPhotoId: v.optional(v.id("productPhotos")),
    /** Required for multi-photo path when caller already bumped via applyMarkAiGenerating. */
    aiGeneration: v.optional(v.number()),
    /** True when triggered by an explicit regen (may upgrade model). */
    isRegeneration: v.optional(v.boolean()),
    /** Explicit model choice from regen context menu; skips upgrade ladder. */
    modelOverride: v.optional(aiImageModel),
  },
  handler: async (ctx, args) => {
    if (args.originalPhotoId) {
      let aiGeneration = args.aiGeneration;
      let previousShopifyFileIds = args.previousShopifyFileIds ?? [];

      if (aiGeneration === undefined) {
        const marked = await ctx.runMutation(
          productPhotosModel.markAiGeneratingInternal,
          {
            productId: args.productId,
            originalPhotoId: args.originalPhotoId,
          },
        );
        aiGeneration = marked.aiGeneration as number;
        const fromMark = (marked.previousShopifyFileIds ?? []) as string[];
        if (fromMark.length > 0) {
          previousShopifyFileIds = [
            ...previousShopifyFileIds,
            ...fromMark,
          ];
        }
      }

      try {
        const payload = await ctx.runQuery(photoAiModel.processingPayload, {
          productId: args.productId,
          originalPhotoId: args.originalPhotoId,
          isRegeneration: args.isRegeneration,
          modelOverride: args.modelOverride,
        });

        if (!payload || payload.mode !== "convex") {
          throw new ConvexError("Original product photo is missing image data.");
        }

        if (previousShopifyFileIds.length > 0) {
          const connection = await ctx.runQuery(
            shopifyModel.firstActiveConnection,
            {},
          );
          if (connection) {
            // Prefer detach+delete when product is already on Shopify so
            // gallery refs are cleared before fileDelete (regen-after-publish).
            await detachAndDeleteShopifyFilesBestEffort(
              ctx,
              connection,
              previousShopifyFileIds,
              payload.shopifyProductId,
            );
          }
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
        const whitened = await whitenOffWhiteBackground(
          generated.data,
          generated.mimeType,
        );
        const storageId = await ctx.storage.store(
          new Blob([new Uint8Array(whitened.data)], {
            type: whitened.mimeType,
          }),
        );
        const url = await ctx.storage.getUrl(storageId);

        try {
          await ctx.runMutation(productPhotosModel.markAiReadyInternal, {
            originalPhotoId: args.originalPhotoId,
            storageId,
            url: url ?? undefined,
            aiGeneration,
            aiModel: payload.aiImageModel,
          });
        } catch (markError) {
          // Row missing or mark failed after store: drop the new blob.
          try {
            await ctx.storage.delete(storageId);
          } catch {
            // Storage may already be gone.
          }
          throw markError;
        }
      } catch (error) {
        await ctx.runMutation(productPhotosModel.markAiFailedInternal, {
          error:
            error instanceof Error
              ? error.message
              : "AI photo generation failed.",
          originalPhotoId: args.originalPhotoId,
          aiGeneration,
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
          isRegeneration: args.isRegeneration,
          modelOverride: args.modelOverride,
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
        await detachAndDeleteShopifyFilesBestEffort(
          ctx,
          connection,
          [args.previousAiShopifyFileId],
          payload.shopifyProductId,
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
      const whitened = await whitenOffWhiteBackground(
        generated.data,
        generated.mimeType,
      );
      const extension = whitened.mimeType.includes("png") ? "png" : "jpg";
      const aiFile = await uploadImageBufferToShopify(connection, {
        alt: `${payload.sku} AI photo`,
        data: whitened.data,
        filename: `${payload.sku}-ai.${extension}`,
        mimeType: whitened.mimeType,
      });

      await ctx.runMutation(photoAiModel.markReady, {
        aiShopifyFileId: aiFile.id,
        aiShopifyFileStatus: aiFile.status,
        aiShopifyFileUrl: aiFile.url,
        productId: args.productId,
        aiImageModel: payload.aiImageModel,
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
