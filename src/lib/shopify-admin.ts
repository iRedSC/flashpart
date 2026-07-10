/** Extract the numeric id from a Shopify GID or bare id string. */
export function shopifyResourceNumericId(
  resourceId: string | null | undefined,
): string | null {
  if (!resourceId) {
    return null;
  }

  const trimmed = resourceId.trim();
  if (!trimmed) {
    return null;
  }

  const fromGid = trimmed.includes("/")
    ? trimmed.split("/").filter(Boolean).at(-1)
    : trimmed;

  if (!fromGid || !/^\d+$/.test(fromGid)) {
    return null;
  }

  return fromGid;
}

/** Build a Shopify admin product URL for the connected shop. */
export function shopifyAdminProductUrl(
  shopDomain: string | null | undefined,
  productId: string | null | undefined,
): string | null {
  if (!shopDomain?.trim()) {
    return null;
  }

  const numericId = shopifyResourceNumericId(productId);
  if (!numericId) {
    return null;
  }

  const domain = shopDomain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  if (!domain) {
    return null;
  }

  return `https://${domain}/admin/products/${numericId}`;
}
