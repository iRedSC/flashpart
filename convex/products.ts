import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import {
  compareProductDisplayOrder,
  migrateLegacyProduct,
  resolveProductPhase,
  type LastError,
  type PendingOperation,
  type ProductPhase,
} from "./productState";
import { normalizeTagString } from "./tags";

const importedProduct = v.object({
  sku: v.string(),
  name: v.string(),
  price: v.number(),
  description: v.optional(v.string()),
  vendor: v.optional(v.string()),
  tags: v.optional(v.string()),
});

function normalizeProduct(product: Doc<"products">) {
  const legacyInput =
    product as Parameters<typeof migrateLegacyProduct>[0];
  const phase = resolveProductPhase(legacyInput);
  const legacy = migrateLegacyProduct(legacyInput);

  return {
    ...product,
    phase,
    pendingOperation:
      (product.pendingOperation ??
        legacy?.pendingOperation) as PendingOperation | undefined,
    needsPhotoReview: product.needsPhotoReview ?? legacy?.needsPhotoReview,
    lastError: (product.lastError ?? legacy?.lastError) as LastError | undefined,
  } satisfies Doc<"products"> & { phase: ProductPhase };
}

export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const products = await ctx.db.query("products").collect();

    return products.map(normalizeProduct).sort(compareProductDisplayOrder);
  },
});

export const reorder = mutation({
  args: {
    sessionToken: v.string(),
    orderedIds: v.array(v.id("products")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    let updated = 0;

    for (let index = 0; index < args.orderedIds.length; index += 1) {
      const product = await ctx.db.get(args.orderedIds[index]);

      if (product && product.sortOrder !== index) {
        await ctx.db.patch(product._id, { sortOrder: index });
        updated += 1;
      }
    }

    return { updated };
  },
});

export const update = mutation({
  args: {
    sessionToken: v.string(),
    id: v.id("products"),
    sku: v.optional(v.string()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    vendor: v.optional(v.string()),
    tags: v.optional(v.string()),
    price: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    const patch: {
      description?: string;
      name?: string;
      price?: number;
      sku?: string;
      tags?: string;
      vendor?: string;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    if (args.sku !== undefined) {
      patch.sku = args.sku;
    }

    if (args.name !== undefined) {
      patch.name = args.name;
    }

    if (args.description !== undefined) {
      patch.description = args.description.trim() || undefined;
    }

    if (args.vendor !== undefined) {
      patch.vendor = args.vendor.trim() || undefined;
    }

    if (args.tags !== undefined) {
      patch.tags = normalizeTagString(args.tags);
    }

    if (args.price !== undefined) {
      patch.price = args.price;
    }

    await ctx.db.patch(args.id, patch);
  },
});

export const create = mutation({
  args: {
    sessionToken: v.string(),
    sku: v.string(),
    name: v.string(),
    price: v.number(),
    description: v.optional(v.string()),
    vendor: v.optional(v.string()),
    tags: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    const sku = args.sku.trim();
    const name = args.name.trim();
    const description = args.description?.trim() || undefined;
    const vendor = args.vendor?.trim() || undefined;
    const tags = normalizeTagString(args.tags);

    if (!sku || !name) {
      throw new ConvexError("SKU and name are required.");
    }

    if (!Number.isFinite(args.price) || args.price < 0) {
      throw new ConvexError("Enter a valid price.");
    }

    const existing = await ctx.db
      .query("products")
      .withIndex("by_sku", (q) => q.eq("sku", sku))
      .first();

    if (existing) {
      throw new ConvexError(`A product with SKU "${sku}" already exists.`);
    }

    const now = Date.now();

    const id = await ctx.db.insert("products", {
      sku,
      name,
      description,
      vendor,
      tags,
      price: args.price,
      phase: "imported",
      createdAt: now,
      updatedAt: now,
    });

    return { id };
  },
});

export const importProducts = mutation({
  args: {
    sessionToken: v.string(),
    products: v.array(importedProduct),
    existingEntryBehavior: v.union(v.literal("overwrite"), v.literal("ignore")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    const now = Date.now();
    let inserted = 0;
    let overwritten = 0;
    let ignored = 0;

    for (const product of args.products) {
      const sku = product.sku.trim();
      const name = product.name.trim();

      if (!sku || !name || !Number.isFinite(product.price)) {
        continue;
      }

      const existing = await ctx.db
        .query("products")
        .withIndex("by_sku", (q) => q.eq("sku", sku))
        .first();

      if (existing) {
        if (args.existingEntryBehavior === "ignore") {
          ignored += 1;
          continue;
        }

        await ctx.db.patch(existing._id, {
          name,
          price: product.price,
          ...(product.description !== undefined
            ? { description: product.description.trim() || undefined }
            : {}),
          ...(product.vendor !== undefined
            ? { vendor: product.vendor.trim() || undefined }
            : {}),
          ...(product.tags !== undefined
            ? { tags: normalizeTagString(product.tags) }
            : {}),
          updatedAt: now,
        });
        overwritten += 1;
        continue;
      }

      await ctx.db.insert("products", {
        sku,
        name,
        description: product.description?.trim() || undefined,
        vendor: product.vendor?.trim() || undefined,
        tags: normalizeTagString(product.tags),
        price: product.price,
        phase: "imported",
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    return { ignored, inserted, overwritten };
  },
});

export const removeMany = mutation({
  args: {
    sessionToken: v.string(),
    ids: v.array(v.id("products")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    let deleted = 0;

    for (const id of args.ids) {
      const product = await ctx.db.get(id);

      if (product) {
        await ctx.db.delete(id);
        deleted += 1;
      }
    }

    return { deleted };
  },
});

export const getFileForDeletion = internalQuery({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const product = await ctx.db.get(args.productId);

    if (!product) {
      return null;
    }

    return {
      captureId: product.captureId,
      shopifyFileId: product.shopifyFileId,
      shopifyStatus: product.shopifyStatus,
    };
  },
});

export const markShopifyFileDeleted = internalMutation({
  args: {
    productId: v.id("products"),
    shopifyFileId: v.string(),
    deletedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);

    if (!product || product.shopifyFileId !== args.shopifyFileId) {
      return;
    }

    await ctx.db.patch(args.productId, {
      aiImageError: undefined,
      aiImagePrompt: undefined,
      aiImageStatus: undefined,
      aiShopifyFileId: undefined,
      aiShopifyFileStatus: undefined,
      aiShopifyFileUrl: undefined,
      captureId: undefined,
      needsPhotoReview: undefined,
      pendingOperation: undefined,
      phase: "imported",
      shopifyFileDeletedAt: args.deletedAt,
      shopifyFileId: undefined,
      shopifyFileStatus: undefined,
      shopifyFileUrl: undefined,
      shopifyStagedResourceUrl: undefined,
      updatedAt: args.deletedAt,
    });

    if (product.captureId) {
      await ctx.db.patch(product.captureId, {
        shopifyFileDeletedAt: args.deletedAt,
        shopifyFileId: undefined,
        shopifyFileStatus: undefined,
        shopifyFileUrl: undefined,
        shopifyStagedResourceUrl: undefined,
        updatedAt: args.deletedAt,
      });
    }
  },
});
