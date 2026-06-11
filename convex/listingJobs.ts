import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("listingJobs").order("desc").collect();
  },
});

export const markRunning = mutation({
  args: {
    jobId: v.id("listingJobs"),
    triggerRunId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
    jobId: v.id("listingJobs"),
    shopifyProductId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
    jobId: v.id("listingJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
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
