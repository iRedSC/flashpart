import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import { productStatus } from "./schema";

const importedProduct = v.object({
  sku: v.string(),
  name: v.string(),
  price: v.number(),
  description: v.optional(v.string()),
});

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

export const update = mutation({
  args: {
    sessionToken: v.string(),
    id: v.id("products"),
    sku: v.optional(v.string()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    price: v.optional(v.number()),
    status: v.optional(productStatus),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    const patch: {
      description?: string;
      name?: string;
      price?: number;
      sku?: string;
      status?: typeof args.status;
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

    if (args.price !== undefined) {
      patch.price = args.price;
    }

    if (args.status !== undefined) {
      patch.status = args.status;
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
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    const sku = args.sku.trim();
    const name = args.name.trim();
    const description = args.description?.trim() || undefined;

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
      price: args.price,
      status: "imported",
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
          updatedAt: now,
        });
        overwritten += 1;
        continue;
      }

      await ctx.db.insert("products", {
        sku,
        name,
        description: product.description?.trim() || undefined,
        price: product.price,
        status: "imported",
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
