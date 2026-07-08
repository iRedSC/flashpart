import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSessionUser } from "./authUtils";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { duplicatePolicy, shopifyPublishTarget } from "./schema";
import { aiImageModel } from "./photoAiConstants";
import {
  DEFAULT_AI_IMAGE_PROMPT,
  GEMINI_IMAGE_MODEL,
} from "./photoAiConstants";
import type { AiImageModelId } from "./photoAiConstants";
import { normalizeTagString } from "./tags";

const defaultSettings = {
  key: "singleton" as const,
  aiImageDefaultPrompt: DEFAULT_AI_IMAGE_PROMPT,
  aiImageModel: GEMINI_IMAGE_MODEL as AiImageModelId,
  duplicatePolicy: "blockExisting" as const,
  shopifyPublishTarget: "draft" as const,
  shopifyProductType: "Part" as const,
  updatedAt: 0,
};

export function resolveAiImageSettings(
  settings: {
    aiImageDefaultPrompt?: string;
    aiImageModel?: AiImageModelId;
  } | null,
) {
  const aiImageDefaultPrompt =
    settings?.aiImageDefaultPrompt?.trim() || DEFAULT_AI_IMAGE_PROMPT;
  const aiImageModel = settings?.aiImageModel ?? GEMINI_IMAGE_MODEL;

  return {
    aiImageDefaultPrompt,
    aiImageModel,
  };
}

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
    const stored = await getSettingsDocument(ctx);

    return {
      ...defaultSettings,
      ...stored,
      ...resolveAiImageSettings(stored),
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

export const setAiImageDefaultPrompt = mutation({
  args: {
    aiImageDefaultPrompt: v.string(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();
    const aiImageDefaultPrompt =
      args.aiImageDefaultPrompt.trim() || DEFAULT_AI_IMAGE_PROMPT;

    if (settings) {
      await ctx.db.patch(settings._id, {
        aiImageDefaultPrompt,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        aiImageDefaultPrompt,
        updatedAt: now,
      });
    }

    return { aiImageDefaultPrompt };
  },
});

export const setAiImageModel = mutation({
  args: {
    aiImageModel,
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        aiImageModel: args.aiImageModel,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        aiImageModel: args.aiImageModel,
        updatedAt: now,
      });
    }

    return { aiImageModel: args.aiImageModel };
  },
});

