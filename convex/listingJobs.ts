import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSessionUser } from "./authUtils";

export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    return await ctx.db.query("listingJobs").order("desc").collect();
  },
});

export const enqueueCreateDrafts = mutation({
  args: {
    sessionToken: v.string(),
    productIds: v.array(v.id("products")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const now = Date.now();
    let queued = 0;

    for (const productId of args.productIds) {
      const product = await ctx.db.get(productId);

      if (!product || product.shopifyProductId) {
        continue;
      }

      await ctx.db.insert("listingJobs", {
        productId,
        groupId: product.groupId,
        captureId: product.captureId,
        type: "createShopifyDraft",
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(productId, {
        status: "processing",
        updatedAt: now,
      });
      queued += 1;
    }

    return { queued };
  },
});

export const markRunning = mutation({
  args: {
    sessionToken: v.string(),
    jobId: v.id("listingJobs"),
    triggerRunId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Listing job not found");
    }

    await ctx.db.patch(args.jobId, {
      status: "running",
      attempts: job.attempts + 1,
      triggerRunId: args.triggerRunId,
      updatedAt: Date.now(),
    });
  },
});

export const markSucceeded = mutation({
  args: {
    sessionToken: v.string(),
    jobId: v.id("listingJobs"),
    shopifyProductId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Listing job not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.jobId, {
      status: "succeeded",
      updatedAt: now,
    });

    if (args.shopifyProductId) {
      await ctx.db.patch(job.productId, {
        shopifyProductId: args.shopifyProductId,
        shopifyStatus: "draft",
        status: "draftCreated",
        updatedAt: now,
      });
    }
  },
});

export const markFailed = mutation({
  args: {
    sessionToken: v.string(),
    jobId: v.id("listingJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const job = await ctx.db.get(args.jobId);

    if (!job) {
      throw new Error("Listing job not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.jobId, {
      status: "failed",
      error: args.error,
      updatedAt: now,
    });
    await ctx.db.patch(job.productId, {
      status: "failed",
      error: args.error,
      updatedAt: now,
    });
  },
});
