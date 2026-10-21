import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, internalMutation } from "./_generated/server";
import { productHasPhotoRows } from "./productPhotos";
import { listUnphotographedDrafts, type ShopifyDraft } from "./shopifyClient";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const currentActiveConnection = makeFunctionReference("shopifyModel.js:currentActiveConnection") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const applySyncRef = makeFunctionReference("shopifyDrafts.js:applySync") as any;

const shopifyDraft = v.object({
  shopifyProductId: v.string(),
  shopifyVariantId: v.optional(v.string()),
  name: v.string(),
  sku: v.string(),
  price: v.number(),
  vendor: v.optional(v.string()),
  productType: v.optional(v.string()),
});

type SyncResult = { added: number; removed: number };

/** Pull Shopify drafts without photos into the Drafts list. */
export const sync = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, args): Promise<SyncResult> => {
    const connection = await ctx.runQuery(currentActiveConnection, args);
    if (!connection) throw new ConvexError("Connect Shopify to load drafts.");
    const drafts = await listUnphotographedDrafts(connection);
    return await ctx.runMutation(applySyncRef, { drafts, shopDomain: connection.shopDomain });
  },
});

/**
 * Mirror the remote list for one shop; other shops' drafts are untouched. Rows that left it (photographed, published, or
 * deleted in Shopify) are dropped unless they hold local work: photos, a
 * publish in flight, or a publish record.
 */
export const applySync = internalMutation({
  args: { drafts: v.array(shopifyDraft), shopDomain: v.string() },
  handler: async (ctx, args): Promise<SyncResult> => {
    const now = Date.now();
    const local = await ctx.db
      .query("products")
      .withIndex("by_listing_kind", (q) => q.eq("listingKind", "shopifyDraft"))
      .collect()
      .then((rows) => rows.filter((row) => row.shopifyDraftShop === args.shopDomain));
    const localByDraftId = new Map(local.map((row) => [row.shopifyDraftId, row]));
    const remoteIds = new Set(args.drafts.map((draft) => draft.shopifyProductId));
    let added = 0;
    let removed = 0;

    for (const draft of args.drafts) {
      const fields = draftFields(draft);
      const row = localByDraftId.get(draft.shopifyProductId);
      if (!row) {
        await ctx.db.insert("products", {
          ...fields,
          listingKind: "shopifyDraft",
          shopifyDraftId: draft.shopifyProductId,
          shopifyDraftShop: args.shopDomain,
          phase: "imported",
          createdAt: now,
          updatedAt: now,
        });
        added += 1;
      } else if (row.phase !== "published" && differs(row, fields)) {
        await ctx.db.patch(row._id, { ...fields, updatedAt: now });
      }
    }

    for (const row of local) {
      if (remoteIds.has(row.shopifyDraftId!) || row.phase === "published" || row.pendingOperation) continue;
      if (await productHasPhotoRows(ctx, row._id)) continue;
      await ctx.db.delete(row._id);
      removed += 1;
    }

    return { added, removed };
  },
});

function draftFields(draft: ShopifyDraft) {
  return {
    name: draft.name,
    sku: draft.sku,
    price: draft.price,
    vendor: draft.vendor,
    productType: draft.productType,
    shopifyVariantId: draft.shopifyVariantId,
  };
}

function differs(row: Record<string, unknown>, fields: ReturnType<typeof draftFields>) {
  return Object.entries(fields).some(([key, value]) => row[key] !== value);
}
