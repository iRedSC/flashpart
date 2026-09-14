import test from 'node:test';
import assert from 'node:assert/strict';
import { hashValue } from '../convex/authUtils.ts';
import { getWorkflowSettings, setAiImageDefaultPrompt, setShopifyPublishTarget, setShopifyInventoryLocationId, setShopifyProductTemplateSuffix } from '../convex/settings.ts';
import { create, update, finishPhotos, importProducts } from '../convex/products.ts';
import { reserveOriginalSlot } from '../convex/productPhotos.ts';
import { enqueueCreateDrafts } from '../convex/listingJobs.ts';
import { processingPayload } from '../convex/photoAi.ts';
import { buildAiGenerationRequest } from '../convex/photoAiConstants.ts';
import { REFURBISHED_IMAGE_PROMPT } from '../convex/listingTypes.ts';
import { createShopifyProduct, createShopifyVariant, updateShopifyVariant, resolveConditionReference, getShopifyProductTypes, getShopifyProductTemplates } from '../convex/shopifyClient.ts';
import { persistedProductIds } from '../src/lib/product-id.ts';

const sessionToken = 'test-session';
async function context(seed = {}) {
  let serial = 0;
  const tables = { authSessions: [{ _id: 'session', tokenHash: await hashValue(sessionToken), userId: 'user', expiresAt: Date.now() + 60000 }], ...seed };
  const scheduled = [];
  const db = {
    query(table) {
      let rows = [...(tables[table] ?? [])];
      const query = {
        withIndex(_name, predicate) {
          const filter = { eq(key, value) { rows = rows.filter(row => row[key] === value); return filter; } };
          predicate?.(filter); return query;
        },
        order() { return query; },
        collect: async () => rows,
        first: async () => rows[0] ?? null,
        unique: async () => { assert.ok(rows.length <= 1); return rows[0] ?? null; },
      };
      return query;
    },
    get: async id => Object.values(tables).flat().find(row => row._id === id) ?? null,
    insert: async (table, value) => { const _id = `${table}-${++serial}`; (tables[table] ??= []).push({ ...value, _id }); return _id; },
    patch: async (id, patch) => { const row = await db.get(id); assert.ok(row, id); Object.assign(row, patch); },
  };
  return { db, tables, scheduled, scheduler: { runAfter: async (...args) => scheduled.push(args) }, storage: { getUrl: async id => `https://test.invalid/${id}` } };
}
const tool = { _id: 'tool', sku: 'REF-1', name: 'Drill', price: 50, phase: 'captured', listingKind: 'refurbished', condition: 'good', photosComplete: true };
const connection = { _id: 'connection', userId: 'user', isActive: true, createdAt: 1, scopes: ['read_metaobjects', 'read_locations', 'write_inventory'] };
const location = 'gid://shopify/Location/123';

test('photo batch queries exclude optimistic product placeholders', () => {
  assert.deepEqual(
    persistedProductIds([
      { _id: 'persisted-product-id' },
      { _id: 'optimistic-product-0' },
      { _id: 'optimistic-product-42' },
    ]),
    ['persisted-product-id'],
  );
});

test('settings writes and reads stay in their workflow; parts retain existing values', async () => {
  const ctx = await context({ appSettings: [{ _id: 'parts', key: 'singleton', duplicatePolicy: 'blockExisting', aiImageDefaultPrompt: 'Existing parts prompt', updatedAt: 0 }] });
  assert.equal((await getWorkflowSettings(ctx, 'refurbished')).aiImageDefaultPrompt, REFURBISHED_IMAGE_PROMPT);
  await setAiImageDefaultPrompt._handler(ctx, { sessionToken, scope: 'gallery', aiImageDefaultPrompt: 'Gallery prompt' });
  await setShopifyPublishTarget._handler(ctx, { sessionToken, scope: 'refurbished', shopifyPublishTarget: 'published' });
  await setShopifyInventoryLocationId._handler(ctx, { sessionToken, shopifyInventoryLocationId: location });
  await setShopifyProductTemplateSuffix._handler(ctx, { sessionToken, shopifyProductTemplateSuffix: 'refurbished' });
  assert.equal((await getWorkflowSettings(ctx, 'parts')).aiImageDefaultPrompt, 'Existing parts prompt');
  assert.equal((await getWorkflowSettings(ctx, 'gallery')).aiImageDefaultPrompt, 'Gallery prompt');
  assert.equal((await getWorkflowSettings(ctx, 'gallery')).shopifyInventoryLocationId, undefined);
  assert.equal((await getWorkflowSettings(ctx, 'parts')).shopifyProductTemplateSuffix, '');
  assert.equal((await getWorkflowSettings(ctx, 'refurbished')).shopifyInventoryLocationId, location);
  assert.equal((await getWorkflowSettings(ctx, 'refurbished')).shopifyProductTemplateSuffix, 'refurbished');
  assert.equal((await getWorkflowSettings(ctx, 'refurbished')).aiImageDefaultPrompt, REFURBISHED_IMAGE_PROMPT);
});

test('editing Parts freezes legacy Gallery defaults before changing them', async () => {
  const ctx = await context({ appSettings: [{ _id: 'parts', key: 'singleton', duplicatePolicy: 'blockExisting', aiImageDefaultPrompt: 'Original shared prompt', aiImageModel: 'gemini-2.5-flash-image', updatedAt: 0 }] });
  await setAiImageDefaultPrompt._handler(ctx, { sessionToken, scope: 'parts', aiImageDefaultPrompt: 'New parts prompt' });
  assert.equal((await getWorkflowSettings(ctx, 'parts')).aiImageDefaultPrompt, 'New parts prompt');
  assert.equal((await getWorkflowSettings(ctx, 'gallery')).aiImageDefaultPrompt, 'Original shared prompt');
  assert.equal((await getWorkflowSettings(ctx, 'gallery')).aiImageModel, 'gemini-2.5-flash-image');
});

test('Parts CSV imports cannot overwrite a refurbished listing', async () => {
  const ctx = await context({ products: [{ ...tool }] });
  const result = await importProducts._handler(ctx, { sessionToken, existingEntryBehavior: 'overwrite', products: [{ sku: tool.sku, name: 'Wrong item', price: 1 }] });
  assert.equal(result.ignored, 1);
  assert.equal(ctx.tables.products[0].name, tool.name);
});

test('create preserves refurbished identity and condition; condition changes require republish', async () => {
  const ctx = await context();
  const { id } = await create._handler(ctx, { sessionToken, sku: 'REF-1', name: 'Drill', price: 50, listingKind: 'refurbished', condition: 'good' });
  const product = await ctx.db.get(id);
  assert.equal(product.listingKind, 'refurbished');
  assert.equal(product.condition, 'good');
  await ctx.db.patch(id, { shopifyProductId: 'shopify-product', phase: 'published' });
  await update._handler(ctx, { sessionToken, id, condition: 'excellent' });
  assert.equal(product.condition, 'excellent');
  assert.equal(product.needsRepublish, true);
});

test('refurbished capture has no app photo cap and adding a photo reopens completion', async () => {
  const originals = Array.from({ length: 25 }, (_, i) => ({ _id: `photo-${i}`, productId: 'tool', kind: 'original', status: 'ready', sortOrder: i, storageId: `storage-${i}` }));
  const ctx = await context({ products: [{ ...tool }], productPhotos: originals });
  await reserveOriginalSlot._handler(ctx, { sessionToken, productId: 'tool' });
  assert.equal(ctx.tables.productPhotos.filter(p => p.kind === 'original').length, 26);
  assert.equal(ctx.tables.products[0].photosComplete, false);
  await assert.rejects(finishPhotos._handler(ctx, { sessionToken, productId: 'tool' }), /Save all photos/);
  for (const photo of ctx.tables.productPhotos) if (photo.kind === 'original') photo.status = 'ready';
  await finishPhotos._handler(ctx, { sessionToken, productId: 'tool' });
  assert.equal(ctx.tables.products[0].photosComplete, true);
  ctx.tables.products[0].listingKind = undefined;
  await assert.rejects(reserveOriginalSlot._handler(ctx, { sessionToken, productId: 'tool' }), /maximum of 5/);
});

test('publishing refuses missing condition, unfinished photos, or missing inventory location', async () => {
  for (const [patch, settings, expected] of [
    [{ condition: undefined }, { shopifyInventoryLocationId: location }, /Select a condition/],
    [{ photosComplete: false }, { shopifyInventoryLocationId: location }, /Finish taking photos/],
    [{}, {}, /Choose an inventory location/],
  ]) {
    const ctx = await context({ products: [{ ...tool, ...patch }], shopifyConnections: [connection], appSettings: [{ _id: 'settings', key: 'refurbished', duplicatePolicy: 'blockExisting', ...settings }] });
    await assert.rejects(enqueueCreateDrafts._handler(ctx, { sessionToken, productIds: ['tool'] }), expected);
    assert.equal(ctx.scheduled.length, 0);
    assert.equal(ctx.tables.listingJobs, undefined);
  }
});

test('refurbished processing resolves its own prompt and preserves wear at every strength', async () => {
  const ctx = await context({ products: [{ ...tool }], productPhotos: [{ _id: 'original', productId: 'tool', kind: 'original', storageId: 'blob' }] });
  const payload = await processingPayload._handler(ctx, { productId: 'tool', originalPhotoId: 'original' });
  assert.equal(payload.aiImagePrompt, REFURBISHED_IMAGE_PROMPT);
  assert.equal(payload.preserveWear, true);
  for (const strength of ['subtle', 'balanced', 'strong']) {
    const request = buildAiGenerationRequest(payload.aiImagePrompt, strength, payload.preserveWear);
    assert.match(request.prompt, /Preserve all scratches/);
    assert.doesNotMatch(request.prompt, /substantially relight it.*remove defects/);
  }
  assert.match(buildAiGenerationRequest('Parts prompt', 'strong').prompt, /remove defects/);
});

test('Shopify receives a condition reference and initial quantity only when creating refurb stock', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    return new Response(JSON.stringify({ data: {
      metaobjectByHandle: { id: 'gid://shopify/Metaobject/10' },
      productCreate: { product: { id: 'product', handle: 'ref-1', status: 'DRAFT' } },
      productVariantsBulkCreate: { productVariants: [{ id: 'variant' }] },
      productVariantsBulkUpdate: { productVariants: [{ id: 'variant' }] },
    } }), { status: 200 });
  });
  const shop = { accessToken: 'test', shopDomain: 'test.myshopify.com' };
  const conditionReference = await resolveConditionReference(shop, 'good');
  assert.deepEqual(requests.at(-1).variables, { handle: { type: 'condition', handle: 'good' } });
  await createShopifyProduct(shop, { title: 'Drill', handle: 'ref-1', publishTarget: 'draft', conditionReference, tags: ['Single Listing', 'Refurbished'], templateSuffix: 'refurbished' });
  assert.deepEqual(requests.at(-1).variables.product.metafields, [{ namespace: 'custom', key: 'condition', type: 'metaobject_reference', value: conditionReference }]);
  assert.equal(requests.at(-1).variables.product.templateSuffix, 'refurbished');
  const variant = { sku: 'REF-1', barcode: 'REF-1', productId: 'product', price: 50 };
  await createShopifyVariant(shop, { ...variant, inventoryLocationId: location });
  assert.deepEqual(requests.at(-1).variables.variants[0].inventoryQuantities, [{ locationId: location, availableQuantity: 1 }]);
  await createShopifyVariant(shop, variant);
  assert.equal(requests.at(-1).variables.variants[0].inventoryQuantities, undefined);
  await updateShopifyVariant(shop, { ...variant, variantId: 'variant' });
  assert.equal(requests.at(-1).variables.variants[0].inventoryQuantities, undefined);
});

test('Shopify product type lookup follows pagination and rejects missing conditions', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.query.includes('query Condition')) return new Response(JSON.stringify({ data: { metaobjectByHandle: null } }));
    calls++;
    return new Response(JSON.stringify({ data: { productTypes: { nodes: calls === 1 ? ['Drill'] : ['Saw'], pageInfo: { hasNextPage: calls === 1, endCursor: calls === 1 ? 'next' : null } } } }));
  });
  const shop = { accessToken: 'test', shopDomain: 'test.myshopify.com' };
  assert.deepEqual(await getShopifyProductTypes(shop), ['Drill', 'Saw']);
  assert.equal(calls, 2);
  await assert.rejects(resolveConditionReference(shop, 'poor'), /was not found/);
});

test('Shopify product template lookup reads the main theme and normalizes suffixes', async t => {
  let request;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ data: { themes: { nodes: [{ files: { nodes: [
      { filename: 'templates/product.json' },
      { filename: 'templates/product.refurbished.json' },
      { filename: 'templates/product.wholesale.liquid' },
      { filename: 'templates/collection.json' },
    ] } }] } } }), { status: 200 });
  });
  const templates = await getShopifyProductTemplates({ accessToken: 'test', shopDomain: 'test.myshopify.com' });
  assert.match(request.query, /roles: \[MAIN\]/);
  assert.deepEqual(templates, [
    { label: 'Default product template', suffix: '' },
    { label: 'refurbished', suffix: 'refurbished' },
    { label: 'wholesale', suffix: 'wholesale' },
  ]);
});
