import { v, type Infer } from "convex/values";

export const settingsScope = v.union(
  v.literal("parts"), v.literal("refurbished"), v.literal("gallery"),
);
export type SettingsScope = Infer<typeof settingsScope>;
export const condition = v.union(
  v.literal("new"), v.literal("good"), v.literal("great"),
  v.literal("excellent"), v.literal("new-previous-gen"), v.literal("poor"),
);
export type Condition = Infer<typeof condition>;
export const CONDITION_OPTIONS: { value: Condition; label: string; }[] = [
  { value: "new", label: "New" },
  { value: "good", label: "Good" },
  { value: "great", label: "Great" },
  { value: "excellent", label: "Excellent" },
  { value: "new-previous-gen", label: "New, previous generation" },
  { value: "poor", label: "Poor" },
];
export const REFURBISHED_IMAGE_PROMPT =
  "A professionally lit product photo with a white background and natural product shadow. Preserve the exact product, markings, colors, scratches, scuffs, dents, rust, blemishes and all other visible wear. Only improve the background, framing and lighting. Never repair, conceal or remove condition evidence.";
export function productSettingsScope(product: { listingKind?: "refurbished"; } | null | undefined): SettingsScope {
  return product?.listingKind === "refurbished" ? "refurbished" : "parts";
}
