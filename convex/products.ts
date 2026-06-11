import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { duplicatePolicy, productStatus } from "./schema";

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
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("products").order("desc").collect();
  },
});

export const seedSampleProducts = mutation({
  args: {},
  handler: async (ctx) => {
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
    id: v.id("products"),
    sku: v.optional(v.string()),
    name: v.optional(v.string()),
    price: v.optional(v.number()),
    status: v.optional(productStatus),
    duplicatePolicy: v.optional(duplicatePolicy),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;

    await ctx.db.patch(id, {
      ...patch,
      updatedAt: Date.now(),
    });
  },
});

export const setDuplicatePolicyForAll = mutation({
  args: {
    duplicatePolicy,
  },
  handler: async (ctx, args) => {
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
