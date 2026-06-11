import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.db.query("groups").order("desc").collect();
    const products = await ctx.db.query("products").collect();

    return groups.map((group) => {
      const groupProducts = products.filter(
        (product) => product.groupId === group._id,
      );
      const completed = groupProducts.filter(
        (product) =>
          product.status === "draftCreated" || product.status === "needsReview",
      ).length;

      return {
        ...group,
        productCount: groupProducts.length,
        completedCount: completed,
      };
    });
  },
});

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    return await ctx.db.insert("groups", {
      name: args.name,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const assignFirstUngrouped = mutation({
  args: {
    groupId: v.id("groups"),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const products = await ctx.db.query("products").collect();
    const candidates = products
      .filter((product) => product.groupId === undefined)
      .slice(0, Math.max(0, args.count));
    const now = Date.now();

    for (const product of candidates) {
      await ctx.db.patch(product._id, {
        groupId: args.groupId,
        status: "grouped",
        updatedAt: now,
      });
    }

    return { assigned: candidates.length };
  },
});

export const nextProduct = query({
  args: {
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const products = await ctx.db
      .query("products")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    return (
      products.find(
        (product) =>
          product.status === "grouped" ||
          product.status === "failed" ||
          product.status === "blockedExistingSku",
      ) ?? null
    );
  },
});
