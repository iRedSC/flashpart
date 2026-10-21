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

/** Stored kind. Missing means a part (rows predate the field). */
export const listingKind = v.union(v.literal("refurbished"), v.literal("shopifyDraft"));
export type StoredListingKind = Infer<typeof listingKind>;
export type ListingKind = "part" | StoredListingKind;
type HasListingKind = { listingKind?: StoredListingKind } | null | undefined;

export function listingKindOf(product: HasListingKind): ListingKind {
  return product?.listingKind ?? "part";
}

/**
 * Everything that differs between kinds lives here, so callers ask a question
 * instead of comparing kind strings.
 * - singleProductCapture: photographed one product at a time (no group, no
 *   app photo cap, operator taps "Done").
 * - fromShopify: the listing already exists in Shopify; publishing attaches
 *   photos and activates it without rewriting Shopify's data.
 */
export const LISTING_KINDS: Record<ListingKind, {
  label: string;
  listPath: string;
  settingsScope: SettingsScope;
  singleProductCapture: boolean;
  fromShopify: boolean;
}> = {
  part: { label: "Part", listPath: "/products", settingsScope: "parts", singleProductCapture: false, fromShopify: false },
  refurbished: { label: "Refurbished tool", listPath: "/refurbished", settingsScope: "refurbished", singleProductCapture: true, fromShopify: false },
  shopifyDraft: { label: "Shopify draft", listPath: "/drafts", settingsScope: "parts", singleProductCapture: true, fromShopify: true },
};

export function listingPolicy(product: HasListingKind) {
  return LISTING_KINDS[listingKindOf(product)];
}

export function productSettingsScope(product: HasListingKind): SettingsScope {
  return listingPolicy(product).settingsScope;
}

/** Kind-specific publish requirements beyond photos (photo readiness is checked separately). */
export function meetsKindPublishRequirements(product: { listingKind?: StoredListingKind; condition?: Condition; photosComplete?: boolean }) {
  return listingKindOf(product) !== "refurbished" || Boolean(product.condition && product.photosComplete);
}
