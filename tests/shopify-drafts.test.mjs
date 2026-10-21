import test from 'node:test';
import assert from 'node:assert/strict';
import { getFunctionName } from 'convex/server';
import { context, sessionToken } from './convex-context.mjs';
import { applySync } from '../convex/shopifyDrafts.ts';
import { listUnphotographedDrafts } from '../convex/shopifyClient.ts';
import { importProducts, update } from '../convex/products.ts';
import { reserveOriginalSlot } from '../convex/productPhotos.ts';
import { recordConvexCapture } from '../convex/captures.ts';
import { enqueueCreateDrafts, jobPayload, markJobFailed, markJobRunning, markJobSucceeded, processQueuedJob } from '../convex/listingJobs.ts';

const shop = { accessToken: 'test', shopDomain: 'test.myshopify.com' };
const draft = { _id: 'draft', listingKind: 'shopifyDraft', shopifyDraftId: 'gid://shopify/Product/1', shopifyDraftShop: 'test.myshopify.com', shopifyVariantId: 'gid://shopify/ProductVariant/1', sku: 'D-1', name: 'Pump', price: 20, phase: 'imported', createdAt: 1, updatedAt: 1 };
const remote = (id, patch = {}) => ({ shopifyProductId: `gid://shopify/Product/${id}`, name: `Product ${id}`, sku: `D-${id}`, price: 10, ...patch });
const approvedPhotos = [
  { _id: 'original', productId: 'draft', kind: 'original', status: 'ready', storageId: 'blob', sortOrder: 0, createdAt: 1 },
  { _id: 'ai', productId: 'draft', kind: 'ai', status: 'ready', aiStatus: 'ready', approvedAt: 2, sourcePhotoId: 'original', sortOrder: 0, createdAt: 1, updatedAt: 1 },
];

test('Shopify draft lookup skips drafts with media and follows pagination', async t => {
  const queries = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    queries.push(query);
    const first = variables.after === null;
    const product = (id, media) => ({ id: `gid://shopify/Product/${id}`, title: ` Pump ${id}`, vendor: '', productType: 'Pump', mediaCount: { count: media }, variants: { nodes: [{ id: `v${id}`, sku: ` P-${id} `, price: '12.50' }] } });
    return new Response(JSON.stringify({ data: { products: {
      nodes: first ? [product(1, 0), product(2, 3)] : [product(3, 0)],
      pageInfo: { hasNextPage: first, endCursor: first ? 'next' : null },
    } } }));
  });
  const drafts = await listUnphotographedDrafts(shop);
  assert.match(queries[0], /status:draft/);
  assert.deepEqual(drafts.map(d => d.shopifyProductId), ['gid://shopify/Product/1', 'gid://shopify/Product/3']);
  assert.deepEqual(drafts[0], { shopifyProductId: 'gid://shopify/Product/1', shopifyVariantId: 'v1', name: ' Pump 1', sku: 'P-1', price: 12.5, vendor: undefined, productType: 'Pump' });
});

test('sync adds new drafts, refreshes changed ones, and drops only rows without local work in this shop', async () => {
  const ctx = await context({
    products: [
      { ...draft },
      { ...draft, _id: 'gone', shopifyDraftId: 'gid://shopify/Product/9' },
      { ...draft, _id: 'photographed', shopifyDraftId: 'gid://shopify/Product/8' },
      { ...draft, _id: 'published', shopifyDraftId: 'gid://shopify/Product/7', phase: 'published' },
      { _id: 'part', sku: 'PART', name: 'Part', price: 1, phase: 'imported' },
      { ...draft, _id: 'other-shop', shopifyDraftShop: 'other.myshopify.com', shopifyDraftId: 'gid://shopify/Product/6' },
    ],
    productPhotos: [{ _id: 'p', productId: 'photographed', kind: 'original', status: 'ready', sortOrder: 0 }],
  });
  const result = await applySync._handler(ctx, { shopDomain: 'test.myshopify.com', drafts: [remote(1, { name: 'Pump v2', price: 25 }), remote(2)] });
  assert.deepEqual(result, { added: 1, removed: 1 });
  assert.deepEqual(ctx.tables.products.map(p => p._id).sort(), ['draft', 'other-shop', 'part', 'photographed', 'products-1', 'published']);
  const refreshed = await ctx.db.get('draft');
  assert.equal(refreshed.name, 'Pump v2');
  assert.equal(refreshed.price, 25);
  const added = await ctx.db.get('products-1');
  assert.equal(added.listingKind, 'shopifyDraft');
  assert.equal(added.shopifyDraftId, 'gid://shopify/Product/2');
  assert.equal(added.shopifyDraftShop, 'test.myshopify.com');
  assert.equal(added.shopifyProductId, undefined, 'unpublished drafts must not look linked');
});

test('drafts are photographed one at a time without a group or photo cap, and stay read-only locally', async () => {
  const originals = Array.from({ length: 8 }, (_, i) => ({ _id: `photo-${i}`, productId: 'draft', kind: 'original', status: 'ready', sortOrder: i, storageId: `s-${i}` }));
  const ctx = await context({ products: [{ ...draft }], productPhotos: originals });
  await recordConvexCapture._handler(ctx, { sessionToken, productId: 'draft' });
  await reserveOriginalSlot._handler(ctx, { sessionToken, productId: 'draft' });
  assert.equal(ctx.tables.productPhotos.filter(p => p.kind === 'original').length, 9);
  await assert.rejects(update._handler(ctx, { sessionToken, id: 'draft', name: 'Renamed' }), /Edit Shopify drafts in Shopify/);
  const imported = await importProducts._handler(ctx, { sessionToken, existingEntryBehavior: 'overwrite', products: [{ sku: 'D-1', name: 'CSV', price: 1 }] });
  assert.equal(imported.ignored, 1);
  assert.equal((await ctx.db.get('draft')).name, 'Pump');
});

async function publishDraft(t, product) {
  const connection = { _id: 'connection', userId: 'user', isActive: true, createdAt: 1, scopes: [], accessToken: 'test', shopDomain: shop.shopDomain };
  const ctx = await context({ products: [product], productPhotos: approvedPhotos, shopifyConnections: [connection] });
  await enqueueCreateDrafts._handler(ctx, { sessionToken, productIds: ['draft'] });
  const jobId = ctx.tables.listingJobs[0]._id;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    return new Response(JSON.stringify({ data: {
      fileUpdate: { files: [{ id: 'file-ai' }] },
      productUpdate: { product: { id: draft.shopifyDraftId, handle: 'pump', status: 'ACTIVE' } },
      publications: { nodes: [{ id: 'pub', name: 'Online Store' }] },
      publishablePublish: { publishable: { id: draft.shopifyDraftId } },
    } }));
  });
  const handlers = { jobPayload, markJobRunning, markJobSucceeded, markJobFailed };
  const run = async (ref, args) => handlers[getFunctionName(ref).split(':')[1]]._handler(ctx, args);
  await processQueuedJob._handler({ runQuery: run, runMutation: run, runAction: async (_ref, { photoId }) => ({ shopifyFileId: `file-${photoId}` }) }, { jobId });
  return { ctx, requests };
}

test('publishing a draft attaches photos and channels while still a draft, activates last, and never rewrites Shopify data', async t => {
  const { ctx, requests } = await publishDraft(t, { ...draft });

  assert.equal(ctx.tables.listingJobs[0].error, undefined);
  const operations = requests.map(r => r.query.match(/(?:mutation|query) (\w+)/)[1]);
  assert.equal(operations.at(-1), 'Activate', 'activation must be the final Shopify call');
  assert.equal(operations[0], 'fileUpdate');
  assert.deepEqual(requests.at(-1).variables.product, { id: draft.shopifyDraftId, status: 'ACTIVE' });
  assert.ok(!operations.some(name => /productCreate|productVariants/.test(name)));
  const published = await ctx.db.get('draft');
  assert.equal(published.phase, 'published');
  assert.equal(published.shopifyStatus, 'published');
  assert.equal(published.shopifyProductId, draft.shopifyDraftId);
  assert.equal(published.pendingOperation, undefined);
});

test('a draft from another Shopify store is never published through the current one', async t => {
  const { ctx, requests } = await publishDraft(t, { ...draft, shopifyDraftShop: 'other.myshopify.com' });
  assert.equal(requests.length, 0);
  assert.match(ctx.tables.listingJobs[0].error, /different Shopify store/);
  assert.equal((await ctx.db.get('draft')).phase, 'imported');
});
