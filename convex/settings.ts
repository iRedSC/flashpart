import { settingsScope, REFURBISHED_IMAGE_PROMPT, type SettingsScope } from "./listingTypes";
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

export function resolveShopifyProductType(
  productType: string | undefined,
  settingsProductType: string | undefined,
) {
  return (
    productType?.trim() ||
    settingsProductType?.trim() ||
    defaultSettings.shopifyProductType
  );
}

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

export async function getSettingsDocument(ctx: QueryCtx | MutationCtx, scope: SettingsScope = "parts") {
  return await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", scope === "parts" ? "singleton" : scope))
    .unique();
}

export function defaultsForScope(scope: SettingsScope = "parts") {
  return {
    ...defaultSettings, key: scope === "parts" ? "singleton" as const : scope,
    ...(scope === "refurbished" ? { aiImageDefaultPrompt: REFURBISHED_IMAGE_PROMPT, aiImageWhitenBackground: false } : {}),
  };
}

export async function getWorkflowSettings(ctx: QueryCtx | MutationCtx, scope: SettingsScope = "parts") {
  const stored = await getSettingsDocument(ctx, scope);
  // Preserve the gallery's existing image defaults until its first independent save.
  const galleryDefaults = !stored && scope === "gallery"
    ? resolveAiImageSettings(await getSettingsDocument(ctx, "parts"))
    : {};
  return { ...defaultsForScope(scope), ...galleryDefaults, ...stored };
}

async function getSettingsForWrite(ctx: MutationCtx, scope: SettingsScope = "parts") {
  const stored = await getSettingsDocument(ctx, scope);
  // Gallery used the shared image settings before workflow tabs existed.
  // Freeze those values before the first Parts edit so the tabs are independent.
  if (scope === "parts" && !(await getSettingsDocument(ctx, "gallery"))) {
    await ctx.db.insert("appSettings", {
      ...defaultsForScope("gallery"),
      ...resolveAiImageSettings(stored),
      updatedAt: Date.now(),
    });
  }
  return stored;
}

export const get = query({
  args: { scope: v.optional(settingsScope), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const stored = await getWorkflowSettings(ctx, args.scope);

    return {
      ...defaultsForScope(args.scope),
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
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
    duplicatePolicy,
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        duplicatePolicy: args.duplicatePolicy,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...await getWorkflowSettings(ctx, args.scope),
        duplicatePolicy: args.duplicatePolicy,
        updatedAt: now,
      });
    }

    return { duplicatePolicy: args.duplicatePolicy };
  },
});

export const setAutoArchiveComplete = mutation({
  args: {
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
    autoArchiveComplete: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        autoArchiveComplete: args.autoArchiveComplete,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...await getWorkflowSettings(ctx, args.scope),
        autoArchiveComplete: args.autoArchiveComplete,
        updatedAt: now,
      });
    }

    return { autoArchiveComplete: args.autoArchiveComplete };
  },
});

export const setAutoArchiveCompleteGroups = mutation({
  args: {
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
    autoArchiveCompleteGroups: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        autoArchiveCompleteGroups: args.autoArchiveCompleteGroups,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...await getWorkflowSettings(ctx, args.scope),
        autoArchiveCompleteGroups: args.autoArchiveCompleteGroups,
        updatedAt: now,
      });
    }

    return { autoArchiveCompleteGroups: args.autoArchiveCompleteGroups };
  },
});

export const setShopifyPublishTarget = mutation({
  args: {
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
    shopifyPublishTarget,
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        shopifyPublishTarget: args.shopifyPublishTarget,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...await getWorkflowSettings(ctx, args.scope),
        shopifyPublishTarget: args.shopifyPublishTarget,
        updatedAt: now,
      });
    }

    return { shopifyPublishTarget: args.shopifyPublishTarget };
  },
});

export const setShopifyProductType = mutation({
  args: {
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
    shopifyProductType: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
    const now = Date.now();
    const shopifyProductType = args.shopifyProductType.trim() || "Part";

    if (settings) {
      await ctx.db.patch(settings._id, {
        shopifyProductType,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...await getWorkflowSettings(ctx, args.scope),
        shopifyProductType,
        updatedAt: now,
      });
    }

    return { shopifyProductType };
  },
});

export const setShopifyDefaultTags = mutation({
  args: {
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
    shopifyDefaultTags: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
    const now = Date.now();
    const shopifyDefaultTags = normalizeTagString(args.shopifyDefaultTags);

    if (settings) {
      await ctx.db.patch(settings._id, {
        shopifyDefaultTags,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...await getWorkflowSettings(ctx, args.scope),
        shopifyDefaultTags,
        updatedAt: now,
      });
    }

    return { shopifyDefaultTags };
  },
});

export const setShopifyShippingPackageId = mutation({
  args: {
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
    shopifyShippingPackageId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
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
        ...await getWorkflowSettings(ctx, args.scope),
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
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
    shopifySalesChannels: v.array(shopifySalesChannelId),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
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
        ...await getWorkflowSettings(ctx, args.scope),
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
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
    const now = Date.now();
    const aiImageDefaultPrompt =
      args.aiImageDefaultPrompt.trim() || defaultsForScope(args.scope).aiImageDefaultPrompt;

    if (settings) {
      await ctx.db.patch(settings._id, {
        aiImageDefaultPrompt,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...await getWorkflowSettings(ctx, args.scope),
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
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        aiImageModel: args.aiImageModel,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...await getWorkflowSettings(ctx, args.scope),
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
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        aiImageEditStrength: args.aiImageEditStrength,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...await getWorkflowSettings(ctx, args.scope),
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
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        aiImageUpgradeModelOnRegen: args.aiImageUpgradeModelOnRegen,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...await getWorkflowSettings(ctx, args.scope),
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
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
    const now = Date.now();

    if (settings) {
      await ctx.db.patch(settings._id, {
        aiImageWhitenBackground: args.aiImageWhitenBackground,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        ...await getWorkflowSettings(ctx, args.scope),
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
    scope: v.optional(settingsScope),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const settings = await getSettingsForWrite(ctx, args.scope);
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
        ...await getWorkflowSettings(ctx, args.scope),
        maxProductPhotos,
        updatedAt: now,
      });
    }

    return { maxProductPhotos };
  },
});


export const setShopifyInventoryLocationId = mutation({
  args: { sessionToken: v.string(), shopifyInventoryLocationId: v.string() },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const location = args.shopifyInventoryLocationId;
    if (location && !/^gid:\/\/shopify\/Location\/\d+$/.test(location)) throw new Error("Choose a Shopify location.");
    const settings = await getSettingsDocument(ctx, "refurbished");
    const patch = { shopifyInventoryLocationId: location || undefined, updatedAt: Date.now() };
    if (settings) await ctx.db.patch(settings._id, patch);
    else await ctx.db.insert("appSettings", { ...defaultsForScope("refurbished"), ...patch });
  },
});
