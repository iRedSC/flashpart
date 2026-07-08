import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSessionUser } from "./authUtils";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { duplicatePolicy, shopifyPublishTarget } from "./schema";
import { normalizeTagString } from "./tags";

const defaultSettings = {
  key: "singleton" as const,
  duplicatePolicy: "blockExisting" as const,
  shopifyPublishTarget: "draft" as const,
  shopifyProductType: "Part" as const,
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

    return { duplicatePolicy: args.duplicatePolicy };
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

export const setShopifyProductType = mutation({
  args: {
    sessionToken: v.string(),
    shopifyProductType: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();
    const shopifyProductType = args.shopifyProductType.trim() || "Part";

    if (settings) {
      await ctx.db.patch(settings._id, {
        shopifyProductType,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        shopifyProductType,
        updatedAt: now,
      });
    }

    return { shopifyProductType };
  },
});

export const setShopifyDefaultTags = mutation({
  args: {
    sessionToken: v.string(),
    shopifyDefaultTags: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();
    const shopifyDefaultTags = normalizeTagString(args.shopifyDefaultTags);

    if (settings) {
      await ctx.db.patch(settings._id, {
        shopifyDefaultTags,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        shopifyDefaultTags,
        updatedAt: now,
      });
    }

    return { shopifyDefaultTags };
  },
});

