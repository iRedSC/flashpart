import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireSessionUser } from "./authUtils";

export const generateUploadUrl = mutation({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await ctx.storage.generateUploadUrl();
  },
});

export const record = mutation({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
    groupId: v.id("groups"),
    rawImageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const now = Date.now();
    const captureId = await ctx.db.insert("captures", {
      productId: args.productId,
      groupId: args.groupId,
      rawImageStorageId: args.rawImageStorageId,
      status: "uploaded",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.productId, {
      captureId,
      rawImageStorageId: args.rawImageStorageId,
      status: "captured",
      updatedAt: now,
    });

    await ctx.db.insert("listingJobs", {
      productId: args.productId,
      groupId: args.groupId,
      captureId,
      type: "processPhoto",
      status: "queued",
      attempts: 0,
      createdAt: now,
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
    processedImageUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const capture = await ctx.db.get(args.captureId);

    if (!capture) {
      throw new Error("Capture not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.captureId, {
      processedImageUrl: args.processedImageUrl,
      status: "processed",
      updatedAt: now,
    });
    await ctx.db.patch(capture.productId, {
      processedImageUrl: args.processedImageUrl,
      status: "needsReview",
      updatedAt: now,
    });
  },
});
