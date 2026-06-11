import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { duplicatePolicy } from "./schema";

const defaultSettings = {
  key: "singleton" as const,
  duplicatePolicy: "blockExisting" as const,
  updatedAt: 0,
};

async function getSettingsDocument(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", "singleton"))
    .unique();
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    return (await getSettingsDocument(ctx)) ?? defaultSettings;
  },
});

export const setDuplicatePolicy = mutation({
  args: {
    duplicatePolicy,
  },
  handler: async (ctx, args) => {
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        duplicatePolicy: args.duplicatePolicy,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        duplicatePolicy: args.duplicatePolicy,
        updatedAt: now,
      });
    }

    const products = await ctx.db.query("products").collect();

    for (const product of products) {
      await ctx.db.patch(product._id, {
        duplicatePolicy: args.duplicatePolicy,
        updatedAt: now,
      });
    }

    return { updatedProducts: products.length };
  },
});

