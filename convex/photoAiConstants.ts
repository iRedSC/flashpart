import { v } from "convex/values";

export const DEFAULT_AI_IMAGE_PROMPT =
  "A professionally lit product photo with white background. Do not change the shape of the subject. Clean up blemishes and scratches. Keep the product shadow.";

export const DEFAULT_AI_IMAGE_EDIT_STRENGTH = "balanced";

export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

export const AI_IMAGE_MODEL_OPTIONS = [
  {
    description: "Best balance of quality and speed for product photo edits.",
    id: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
  },
  {
    description: "Fastest and cheapest. Less reliable for reference-photo edits.",
    id: "gemini-3.1-flash-lite-image",
    label: "Gemini 3.1 Flash Lite Image",
  },
  {
    description: "Earlier flash image model.",
    id: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
  },
] as const;

export const AI_IMAGE_EDIT_STRENGTH_OPTIONS = [
  {
    description: "Stay very close to the original capture.",
    id: "subtle",
    label: "Subtle",
  },
  {
    description: "Visible cleanup while preserving product shape.",
    id: "balanced",
    label: "Balanced",
  },
  {
    description: "Clear studio-style transformation.",
    id: "strong",
    label: "Strong",
  },
] as const;

export type AiImageModelId = (typeof AI_IMAGE_MODEL_OPTIONS)[number]["id"];
export type AiImageEditStrength =
  (typeof AI_IMAGE_EDIT_STRENGTH_OPTIONS)[number]["id"];

export const aiImageModel = v.union(
  v.literal("gemini-3.1-flash-image"),
  v.literal("gemini-3.1-flash-lite-image"),
  v.literal("gemini-2.5-flash-image"),
);

export const aiImageEditStrength = v.union(
  v.literal("subtle"),
  v.literal("balanced"),
  v.literal("strong"),
);

export function isAiImageModel(value: string): value is AiImageModelId {
  return AI_IMAGE_MODEL_OPTIONS.some((option) => option.id === value);
}

export function isAiImageEditStrength(
  value: string,
): value is AiImageEditStrength {
  return AI_IMAGE_EDIT_STRENGTH_OPTIONS.some((option) => option.id === value);
}

export function buildAiGenerationRequest(
  prompt: string,
  editStrength: AiImageEditStrength,
) {
  const strengthConfig: Record<
    AiImageEditStrength,
    { preamble: string; temperature: number }
  > = {
    subtle: {
      preamble:
        "Edit the provided reference image conservatively. Make only minimal visible refinements while preserving the original composition, lighting, angle, and product shape as closely as possible.",
      temperature: 0.35,
    },
    balanced: {
      preamble:
        "Edit the provided reference image. Follow the instructions below while keeping the same product identity, silhouette, and camera angle.",
      temperature: 0.75,
    },
    strong: {
      preamble:
        "Edit the provided reference image with clearly visible improvements. Keep the same product identity and silhouette, but substantially relight it, simplify the background, and remove defects. The result should look meaningfully different from the original capture.",
      temperature: 1,
    },
  };
  const config = strengthConfig[editStrength];

  return {
    prompt: `${config.preamble}\n\n${prompt.trim()}`,
    temperature: config.temperature,
  };
}

export function imageSizeForModel(model: AiImageModelId) {
  return model === "gemini-3.1-flash-lite-image" ? "1K" : "1K";
}
