import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSessionUser } from "./authUtils";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  duplicatePolicy,
  shopifyPublishTarget,
  shopifySalesChannelId,
} from "./schema";
import { aiImageEditStrength, aiImageModel } from "./photoAiConstants";
import {
  DEFAULT_AI_IMAGE_EDIT_STRENGTH,
  DEFAULT_AI_IMAGE_PROMPT,
  GEMINI_IMAGE_MODEL,
} from "./photoAiConstants";
import type { AiImageEditStrength, AiImageModelId } from "./photoAiConstants";
import {
  DEFAULT_SHOPIFY_SALES_CHANNELS,
  normalizeShopifyShippingPackageId,
  resolveShopifySalesChannels,
} from "./shopifyPublishSettings";
import { normalizeTagString } from "./tags";

const DEFAULT_MAX_PRODUCT_PHOTOS = 5;
const MIN_MAX_PRODUCT_PHOTOS = 1;
const MAX_MAX_PRODUCT_PHOTOS = 20;

const defaultSettings = {
  key: "singleton" as const,
  aiImageDefaultPrompt: DEFAULT_AI_IMAGE_PROMPT,
  aiImageEditStrength: DEFAULT_AI_IMAGE_EDIT_STRENGTH as AiImageEditStrength,
  aiImageModel: GEMINI_IMAGE_MODEL as AiImageModelId,
  aiImageUpgradeModelOnRegen: false,
  aiImageWhitenBackground: true,
  autoArchiveComplete: false,
  autoArchiveCompleteGroups: false,
  duplicatePolicy: "blockExisting" as const,
  maxProductPhotos: DEFAULT_MAX_PRODUCT_PHOTOS,
  shopifyPublishTarget: "draft" as const,
  shopifyProductType: "Part" as const,
  shopifySalesChannels: [...DEFAULT_SHOPIFY_SALES_CHANNELS],
  updatedAt: 0,
};

export function resolveMaxProductPhotos(
  settings: { maxProductPhotos?: number } | null,
) {
  const value = settings?.maxProductPhotos;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_PRODUCT_PHOTOS;
  }

  return Math.min(
    MAX_MAX_PRODUCT_PHOTOS,
    Math.max(MIN_MAX_PRODUCT_PHOTOS, Math.round(value)),
  );
}

export function resolveAiImageSettings(
  settings: {
    aiImageDefaultPrompt?: string;
    aiImageEditStrength?: AiImageEditStrength;
    aiImageModel?: AiImageModelId;
    aiImageUpgradeModelOnRegen?: boolean;
    aiImageWhitenBackground?: boolean;
  } | null,
) {
  const aiImageDefaultPrompt =
    settings?.aiImageDefaultPrompt?.trim() || DEFAULT_AI_IMAGE_PROMPT;
  const aiImageModel = settings?.aiImageModel ?? GEMINI_IMAGE_MODEL;
  const aiImageEditStrength =
    settings?.aiImageEditStrength ?? DEFAULT_AI_IMAGE_EDIT_STRENGTH;
  const aiImageUpgradeModelOnRegen =
    settings?.aiImageUpgradeModelOnRegen === true;
  // Default on: missing/undefined keeps today's always-whiten behavior.
  const aiImageWhitenBackground = settings?.aiImageWhitenBackground !== false;

  return {
    aiImageDefaultPrompt,
    aiImageEditStrength,
    aiImageModel,
    aiImageUpgradeModelOnRegen,
    aiImageWhitenBackground,
  };
}

export async function getSettingsDocument(ctx: QueryCtx | MutationCtx) {
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
      maxProductPhotos: resolveMaxProductPhotos(stored),
      shopifySalesChannels: resolveShopifySalesChannels(
        stored?.shopifySalesChannels,
      ),
      shopifyShippingPackageId:
        normalizeShopifyShippingPackageId(stored?.shopifyShippingPackageId) ??
        "",
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

export const setAutoArchiveComplete = mutation({
  args: {
    sessionToken: v.string(),
    autoArchiveComplete: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        autoArchiveComplete: args.autoArchiveComplete,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        autoArchiveComplete: args.autoArchiveComplete,
        updatedAt: now,
      });
    }

    return { autoArchiveComplete: args.autoArchiveComplete };
  },
});

export const setAutoArchiveCompleteGroups = mutation({
  args: {
    sessionToken: v.string(),
    autoArchiveCompleteGroups: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        autoArchiveCompleteGroups: args.autoArchiveCompleteGroups,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        autoArchiveCompleteGroups: args.autoArchiveCompleteGroups,
        updatedAt: now,
      });
    }

    return { autoArchiveCompleteGroups: args.autoArchiveCompleteGroups };
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

export const setShopifyShippingPackageId = mutation({
  args: {
    sessionToken: v.string(),
    shopifyShippingPackageId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();
    const shopifyShippingPackageId =
      normalizeShopifyShippingPackageId(args.shopifyShippingPackageId) ?? "";

    if (settings) {
      await ctx.db.patch(settings._id, {
        shopifyShippingPackageId: shopifyShippingPackageId || undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        ...(shopifyShippingPackageId
          ? { shopifyShippingPackageId }
          : {}),
        updatedAt: now,
      });
    }

    return { shopifyShippingPackageId };
  },
});

export const setShopifySalesChannels = mutation({
  args: {
    sessionToken: v.string(),
    shopifySalesChannels: v.array(shopifySalesChannelId),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();
    const shopifySalesChannels = resolveShopifySalesChannels(
      args.shopifySalesChannels,
    );

    if (settings) {
      await ctx.db.patch(settings._id, {
        shopifySalesChannels,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        shopifySalesChannels,
        updatedAt: now,
      });
    }

    return { shopifySalesChannels };
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

export const setAiImageEditStrength = mutation({
  args: {
    aiImageEditStrength,
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        aiImageEditStrength: args.aiImageEditStrength,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        aiImageEditStrength: args.aiImageEditStrength,
        updatedAt: now,
      });
    }

    return { aiImageEditStrength: args.aiImageEditStrength };
  },
});

export const setAiImageUpgradeModelOnRegen = mutation({
  args: {
    aiImageUpgradeModelOnRegen: v.boolean(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        aiImageUpgradeModelOnRegen: args.aiImageUpgradeModelOnRegen,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        aiImageUpgradeModelOnRegen: args.aiImageUpgradeModelOnRegen,
        updatedAt: now,
      });
    }

    return { aiImageUpgradeModelOnRegen: args.aiImageUpgradeModelOnRegen };
  },
});

export const setAiImageWhitenBackground = mutation({
  args: {
    aiImageWhitenBackground: v.boolean(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        aiImageWhitenBackground: args.aiImageWhitenBackground,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        aiImageWhitenBackground: args.aiImageWhitenBackground,
        updatedAt: now,
      });
    }

    return { aiImageWhitenBackground: args.aiImageWhitenBackground };
  },
});

export const setMaxProductPhotos = mutation({
  args: {
    maxProductPhotos: v.number(),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsDocument(ctx);
    const now = Date.now();
    const maxProductPhotos = resolveMaxProductPhotos({
      maxProductPhotos: args.maxProductPhotos,
    });

    if (settings) {
      await ctx.db.patch(settings._id, {
        maxProductPhotos,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...defaultSettings,
        maxProductPhotos,
        updatedAt: now,
      });
    }

    return { maxProductPhotos };
  },
});

