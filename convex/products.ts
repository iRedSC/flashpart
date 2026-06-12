import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import { duplicatePolicy, productStatus } from "./schema";

const importedProduct = v.object({
  sku: v.string(),
  name: v.string(),
  price: v.number(),
});

const sampleProducts = [
  ["FP-1001", "Drive Belt, 3/8 in.", 12.99],
  ["FP-1002", "Brush Cap Assembly", 6.75],
  ["FP-1003", "Trigger Switch", 18.5],
  ["FP-1004", "Carbon Brush Set", 9.25],
  ["FP-1005", "Blade Guard Spring", 4.4],
  ["FP-1006", "Motor Housing Screw", 1.35],
  ["FP-1007", "Depth Stop Knob", 7.95],
  ["FP-1008", "Retaining Ring", 2.15],
  ["FP-1009", "Bearing Plate", 14.2],
  ["FP-1010", "Cord Clamp", 3.1],
] as const;

function statusAfterPhotoRemoval(
  product: { groupId?: unknown },
): "grouped" | "imported" {
  return product.groupId ? "grouped" : "imported";
}

export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const products = await ctx.db.query("products").collect();

    // Manually ordered products sort by sortOrder; products without one
    // (new imports) surface first, newest first, until the next reorder.
    return products.sort((left, right) => {
      if (left.sortOrder !== undefined && right.sortOrder !== undefined) {
        return left.sortOrder - right.sortOrder;
      }

      if (left.sortOrder === undefined && right.sortOrder === undefined) {
        return right.createdAt - left.createdAt;
      }

      return left.sortOrder === undefined ? -1 : 1;
    });
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

export const seedSampleProducts = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const existing = await ctx.db.query("products").first();

    if (existing) {
      return { inserted: 0 };
    }

    const now = Date.now();
    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();

    for (const [sku, name, price] of sampleProducts) {
      await ctx.db.insert("products", {
        sku,
        name,
        price,
        status: "imported",
        duplicatePolicy: settings?.duplicatePolicy ?? "blockExisting",
        createdAt: now,
        updatedAt: now,
      });
    }

    return { inserted: sampleProducts.length };
  },
});

export const update = mutation({
  args: {
    sessionToken: v.string(),
    id: v.id("products"),
    sku: v.optional(v.string()),
    name: v.optional(v.string()),
    price: v.optional(v.number()),
    status: v.optional(productStatus),
    duplicatePolicy: v.optional(duplicatePolicy),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    await ctx.db.patch(args.id, {
      sku: args.sku,
      name: args.name,
      price: args.price,
      status: args.status,
      duplicatePolicy: args.duplicatePolicy,
      updatedAt: Date.now(),
    });
  },
});

export const create = mutation({
  args: {
    sessionToken: v.string(),
    sku: v.string(),
    name: v.string(),
    price: v.number(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    const sku = args.sku.trim();
    const name = args.name.trim();

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

    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const now = Date.now();

    const id = await ctx.db.insert("products", {
      sku,
      name,
      price: args.price,
      status: "imported",
      duplicatePolicy: settings?.duplicatePolicy ?? "blockExisting",
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

    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
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
          updatedAt: now,
        });
        overwritten += 1;
        continue;
      }

      await ctx.db.insert("products", {
        sku,
        name,
        price: product.price,
        status: "imported",
        duplicatePolicy: settings?.duplicatePolicy ?? "blockExisting",
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
      shopifyFileDeletedAt: args.deletedAt,
      shopifyFileId: undefined,
      shopifyFileStatus: undefined,
      shopifyFileUrl: undefined,
      shopifyStagedResourceUrl: undefined,
      status: statusAfterPhotoRemoval(product),
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

export const setDuplicatePolicyForAll = mutation({
  args: {
    sessionToken: v.string(),
    duplicatePolicy,
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const products = await ctx.db.query("products").collect();
    const now = Date.now();

    for (const product of products) {
      await ctx.db.patch(product._id, {
        duplicatePolicy: args.duplicatePolicy,
        updatedAt: now,
      });
    }

    return { updated: products.length };
  },
});
