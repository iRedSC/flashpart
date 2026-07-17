export const SHOPIFY_SALES_CHANNEL_IDS = [
  "online_store",
  "pos",
  "shop",
  "google_youtube",
] as const;

export type ShopifySalesChannelId = (typeof SHOPIFY_SALES_CHANNEL_IDS)[number];

export const SHOPIFY_SALES_CHANNEL_OPTIONS: Array<{
  id: ShopifySalesChannelId;
  label: string;
  matchNames: string[];
}> = [
  {
    id: "online_store",
    label: "Online Store",
    matchNames: ["Online Store"],
  },
  {
    id: "pos",
    label: "POS",
    matchNames: ["Point of Sale", "POS"],
  },
  {
    id: "shop",
    label: "Shop",
    matchNames: ["Shop"],
  },
  {
    id: "google_youtube",
    label: "Google & Youtube",
    matchNames: ["Google & YouTube", "Google & Youtube"],
  },
];

export const DEFAULT_SHOPIFY_SALES_CHANNELS: ShopifySalesChannelId[] = [
  ...SHOPIFY_SALES_CHANNEL_IDS,
];

const ALLOWED_SALES_CHANNELS = new Set<string>(SHOPIFY_SALES_CHANNEL_IDS);

export function normalizeShopifyShippingPackageId(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("gid://")) {
    return trimmed;
  }

  if (/^\d+$/.test(trimmed)) {
    return `gid://shopify/CustomShippingPackage/${trimmed}`;
  }

  return trimmed;
}

export function resolveShopifySalesChannels(
  value: string[] | undefined,
): ShopifySalesChannelId[] {
  if (!value) {
    return [...DEFAULT_SHOPIFY_SALES_CHANNELS];
  }

  return value.filter((id): id is ShopifySalesChannelId =>
    ALLOWED_SALES_CHANNELS.has(id),
  );
}

export function publicationMatchesChannel(
  publicationName: string,
  channelId: ShopifySalesChannelId,
) {
  const option = SHOPIFY_SALES_CHANNEL_OPTIONS.find(
    (entry) => entry.id === channelId,
  );
  if (!option) {
    return false;
  }

  const normalized = publicationName.trim().toLowerCase();
  return option.matchNames.some(
    (name) => name.toLowerCase() === normalized,
  );
}
