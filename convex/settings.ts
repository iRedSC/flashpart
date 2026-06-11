import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSessionUser } from "./authUtils";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { duplicatePolicy, shopifyPublishTarget } from "./schema";

const defaultSettings = {
  key: "singleton" as const,
  duplicatePolicy: "blockExisting" as const,
  shopifyPublishTarget: "draft" as const,
  updatedAt: 0,
};

async function getSettingsDocument(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", "singleton"))
    .unique();
}

export const get = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return {
      ...defaultSettings,
      ...((await getSettingsDocument(ctx)) ?? {}),
    };
  },
});

export const setDuplicatePolicy = mutation({
  args: {
    sessionToken: v.string(),
    duplicatePolicy,
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
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

export const setShopifyPublishTarget = mutation({
  args: {
    sessionToken: v.string(),
    shopifyPublishTarget,
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        shopifyPublishTarget: args.shopifyPublishTarget,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        shopifyPublishTarget: args.shopifyPublishTarget,
        updatedAt: now,
      });
    }

    return { shopifyPublishTarget: args.shopifyPublishTarget };
  },
});

