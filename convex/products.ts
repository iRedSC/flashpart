import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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

export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await ctx.db.query("products").order("desc").collect();
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
