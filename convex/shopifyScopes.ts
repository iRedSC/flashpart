/** Scopes refurbished listings need: condition metaobjects, locations, stock. */
export const REFURBISHED_SCOPES = ["read_metaobjects", "read_locations", "write_inventory"] as const;

/**
 * Shopify omits a read_ scope from the granted list when it grants the matching
 * write_ scope, so a read_ requirement is met by either.
 */
export function hasShopifyScopes(granted: readonly string[], required: readonly string[]) {
  return required.every(scope =>
    granted.includes(scope) ||
    (scope.startsWith("read_") && granted.includes(`write_${scope.slice("read_".length)}`)));
}
