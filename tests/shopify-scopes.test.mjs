import test from 'node:test';
import assert from 'node:assert/strict';
import { hasShopifyScopes, REFURBISHED_SCOPES } from '../convex/shopifyScopes.ts';

test('a write scope satisfies its read requirement', () => {
  // Shopify lists write_metaobjects without read_metaobjects.
  assert.equal(hasShopifyScopes(['write_metaobjects', 'read_locations', 'write_inventory'], REFURBISHED_SCOPES), true);
});

test('a read scope does not satisfy a write requirement', () => {
  assert.equal(hasShopifyScopes(['read_metaobjects', 'read_locations', 'read_inventory'], REFURBISHED_SCOPES), false);
});

test('a missing scope fails', () => {
  assert.equal(hasShopifyScopes(['write_metaobjects', 'write_inventory'], REFURBISHED_SCOPES), false);
});
