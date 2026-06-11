import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import { shopifyFileStatus } from "./schema";

export const record = mutation({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
    groupId: v.id("groups"),
    shopifyFileId: v.optional(v.string()),
    shopifyFileStatus: v.optional(shopifyFileStatus),
    shopifyFileUrl: v.optional(v.string()),
    shopifyStagedResourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const now = Date.now();
    const captureId = await ctx.db.insert("captures", {
      productId: args.productId,
      groupId: args.groupId,
      shopifyFileId: args.shopifyFileId,
      shopifyFileStatus: args.shopifyFileStatus,
      shopifyFileUrl: args.shopifyFileUrl,
      shopifyStagedResourceUrl: args.shopifyStagedResourceUrl,
      status: "uploaded",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.productId, {
      captureId,
      shopifyFileId: args.shopifyFileId,
      shopifyFileStatus: args.shopifyFileStatus,
      shopifyFileUrl: args.shopifyFileUrl,
      shopifyStagedResourceUrl: args.shopifyStagedResourceUrl,
      error: undefined,
      status: "captured",
      updatedAt: now,
    });

    return captureId;
  },
});

export const markProcessing = mutation({
  args: {
    sessionToken: v.string(),
    captureId: v.id("captures"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const capture = await ctx.db.get(args.captureId);

    if (!capture) {
      throw new Error("Capture not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.captureId, {
      status: "processing",
      updatedAt: now,
    });
    await ctx.db.patch(capture.productId, {
      status: "processing",
      updatedAt: now,
    });
  },
});

export const markProcessed = mutation({
  args: {
    sessionToken: v.string(),
    captureId: v.id("captures"),
    shopifyFileUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const capture = await ctx.db.get(args.captureId);

    if (!capture) {
      throw new Error("Capture not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.captureId, {
      shopifyFileStatus: "ready",
      shopifyFileUrl: args.shopifyFileUrl,
      status: "processed",
      updatedAt: now,
    });
    await ctx.db.patch(capture.productId, {
      shopifyFileStatus: "ready",
      shopifyFileUrl: args.shopifyFileUrl,
      status: "needsReview",
      updatedAt: now,
    });
  },
});
