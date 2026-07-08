export const DEFAULT_AI_IMAGE_PROMPT =
  "A professionally lit product photo with white background. Do not change the shape of the subject. Clean up blemishes and scratches. Keep the product shadow.";

export const AI_IMAGE_MODEL_OPTIONS = [
  {
    id: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image",
  },
] as const;

export type AiImageModelId = (typeof AI_IMAGE_MODEL_OPTIONS)[number]["id"];

export const DEFAULT_AI_IMAGE_MODEL: AiImageModelId = "gemini-3.1-flash-image";
