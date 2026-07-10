import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import {
  maybeAutoArchiveGroup,
  maybeUnarchiveGroupForActiveProduct,
} from "./groups";
import {
  canArchive,
  compareProductDisplayOrder,
  migrateLegacyProduct,
  needsRepublishPatch,
  resolveProductPhase,
  type LastError,
  type PendingOperation,
  type ProductPhase,
} from "./productState";
import { normalizeTagString } from "./tags";

const importedProduct = v.object({
  sku: v.string(),
  name: v.string(),
  price: v.number(),
  description: v.optional(v.string()),
  vendor: v.optional(v.string()),
  tags: v.optional(v.string()),
});

function normalizeProduct(product: Doc<"products">) {
  const legacyInput =
    product as Parameters<typeof migrateLegacyProduct>[0];
  const phase = resolveProductPhase(legacyInput);
  const legacy = migrateLegacyProduct(legacyInput);

  return {
    ...product,
    phase,
    pendingOperation:
      (product.pendingOperation ??
        legacy?.pendingOperation) as PendingOperation | undefined,
    needsPhotoReview: product.needsPhotoReview ?? legacy?.needsPhotoReview,
    needsRepublish: product.needsRepublish,
    lastError: (product.lastError ?? legacy?.lastError) as LastError | undefined,
  } satisfies Doc<"products"> & { phase: ProductPhase };
}

export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const products = await ctx.db.query("products").collect();

    return products.map(normalizeProduct).sort(compareProductDisplayOrder);
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
    vendor: v.optional(v.string()),
    tags: v.optional(v.string()),
    price: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    const product = await ctx.db.get(args.id);

    if (!product) {
      throw new ConvexError("Product not found.");
    }

    const patch: {
      description?: string;
      name?: string;
      needsRepublish?: true;
      price?: number;
      sku?: string;
      tags?: string;
      vendor?: string;
      updatedAt: number;
    } = { updatedAt: Date.now() };

    let changed = false;

    if (args.sku !== undefined && args.sku !== product.sku) {
      patch.sku = args.sku;
      changed = true;
    }

    if (args.name !== undefined && args.name !== product.name) {
      patch.name = args.name;
      changed = true;
    }

    if (args.description !== undefined) {
      const description = args.description.trim() || undefined;
      if (description !== product.description) {
        patch.description = description;
        changed = true;
      }
    }

    if (args.vendor !== undefined) {
      const vendor = args.vendor.trim() || undefined;
      if (vendor !== product.vendor) {
        patch.vendor = vendor;
        changed = true;
      }
    }

    if (args.tags !== undefined) {
      const tags = normalizeTagString(args.tags);
      if (tags !== product.tags) {
        patch.tags = tags;
        changed = true;
      }
    }

    if (args.price !== undefined && args.price !== product.price) {
      patch.price = args.price;
      changed = true;
    }

    if (changed) {
      Object.assign(patch, needsRepublishPatch(product));
    }

    if (!changed) {
      return;
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
    vendor: v.optional(v.string()),
    tags: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);

    const sku = args.sku.trim();
    const name = args.name.trim();
    const description = args.description?.trim() || undefined;
    const vendor = args.vendor?.trim() || undefined;
    const tags = normalizeTagString(args.tags);

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
      vendor,
      tags,
      price: args.price,
      phase: "imported",
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

        const description =
          product.description !== undefined
            ? product.description.trim() || undefined
            : undefined;
        const vendor =
          product.vendor !== undefined
            ? product.vendor.trim() || undefined
            : undefined;
        const tags =
          product.tags !== undefined
            ? normalizeTagString(product.tags)
            : undefined;

        const changed =
          name !== existing.name ||
          product.price !== existing.price ||
          (product.description !== undefined &&
            description !== existing.description) ||
          (product.vendor !== undefined && vendor !== existing.vendor) ||
          (product.tags !== undefined && tags !== existing.tags);

        await ctx.db.patch(existing._id, {
          name,
          price: product.price,
          ...(product.description !== undefined ? { description } : {}),
          ...(product.vendor !== undefined ? { vendor } : {}),
          ...(product.tags !== undefined ? { tags } : {}),
          ...(changed ? needsRepublishPatch(existing) : {}),
          updatedAt: now,
        });
        overwritten += 1;
        continue;
      }

      await ctx.db.insert("products", {
        sku,
        name,
        description: product.description?.trim() || undefined,
        vendor: product.vendor?.trim() || undefined,
        tags: normalizeTagString(product.tags),
        price: product.price,
        phase: "imported",
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

export const archiveMany = mutation({
  args: {
    sessionToken: v.string(),
    ids: v.array(v.id("products")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const now = Date.now();
    let archived = 0;
    let skippedErrored = 0;
    const touchedGroupIds = new Set<Id<"groups">>();

    for (const id of args.ids) {
      const product = await ctx.db.get(id);

      if (!product) {
        continue;
      }

      if (!canArchive(product)) {
        skippedErrored += 1;
        continue;
      }

      if (product.archivedAt !== undefined) {
        continue;
      }

      await ctx.db.patch(id, {
        archivedAt: now,
        updatedAt: now,
      });
      archived += 1;

      if (product.groupId) {
        touchedGroupIds.add(product.groupId);
      }
    }

    for (const groupId of touchedGroupIds) {
      await maybeAutoArchiveGroup(ctx, groupId, now);
    }

    return { archived, skippedErrored };
  },
});

export const unarchiveMany = mutation({
  args: {
    sessionToken: v.string(),
    ids: v.array(v.id("products")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const now = Date.now();
    let unarchived = 0;
    const touchedGroupIds = new Set<Id<"groups">>();

    for (const id of args.ids) {
      const product = await ctx.db.get(id);

      if (!product || product.archivedAt === undefined) {
        continue;
      }

      await ctx.db.patch(id, {
        archivedAt: undefined,
        updatedAt: now,
      });
      unarchived += 1;

      if (product.groupId) {
        touchedGroupIds.add(product.groupId);
      }
    }

    for (const groupId of touchedGroupIds) {
      await maybeUnarchiveGroupForActiveProduct(ctx, groupId, now);
    }

    return { unarchived };
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
      aiImageError: undefined,
      aiImagePrompt: undefined,
      aiImageStatus: undefined,
      aiShopifyFileId: undefined,
      aiShopifyFileStatus: undefined,
      aiShopifyFileUrl: undefined,
      captureId: undefined,
      needsPhotoReview: undefined,
      needsRepublish: undefined,
      pendingOperation: undefined,
      phase: "imported",
      shopifyFileDeletedAt: args.deletedAt,
      shopifyFileId: undefined,
      shopifyFileStatus: undefined,
      shopifyFileUrl: undefined,
      shopifyStagedResourceUrl: undefined,
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
