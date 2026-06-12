import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSessionUser } from "./authUtils";
import {
  compareProductDisplayOrder,
  isGroupCaptureComplete,
  isPendingCapture,
  resolveProductPhase,
} from "./productState";

export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const groups = await ctx.db.query("groups").order("desc").collect();
    const products = await ctx.db.query("products").collect();

    return groups.map((group) => {
      const groupProducts = products.filter(
        (product) => product.groupId === group._id,
      );
      const completed = groupProducts.filter((product) =>
        isGroupCaptureComplete({ phase: resolveProductPhase(product) }),
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
    sessionToken: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
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
    sessionToken: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const products = await ctx.db.query("products").collect();
    const candidates = products.filter((product) => product.groupId === undefined);
    const now = Date.now();

    for (const product of candidates) {
      await ctx.db.patch(product._id, {
        groupId: args.groupId,
        updatedAt: now,
      });
    }

    return { assigned: candidates.length };
  },
});

export const remove = mutation({
  args: {
    sessionToken: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const group = await ctx.db.get(args.groupId);

    if (!group) {
      return { deleted: false, ungrouped: 0 };
    }

    const products = await ctx.db
      .query("products")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const now = Date.now();

    for (const product of products) {
      await ctx.db.patch(product._id, {
        groupId: undefined,
        updatedAt: now,
      });
    }

    await ctx.db.delete(args.groupId);

    return { deleted: true, ungrouped: products.length };
  },
});

export const assignProducts = mutation({
  args: {
    sessionToken: v.string(),
    groupId: v.id("groups"),
    productIds: v.array(v.id("products")),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const now = Date.now();
    let assigned = 0;

    for (const productId of args.productIds) {
      const product = await ctx.db.get(productId);

      if (!product) {
        continue;
      }

      await ctx.db.patch(productId, {
        groupId: args.groupId,
        updatedAt: now,
      });
      assigned += 1;
    }

    return { assigned };
  },
});

export const nextProduct = query({
  args: {
    sessionToken: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    await requireSessionUser(ctx, args.sessionToken);
    const products = await ctx.db
      .query("products")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    return (
      products
        .sort(compareProductDisplayOrder)
        .find((product) =>
          isPendingCapture({ phase: resolveProductPhase(product) }),
        ) ?? null
    );
  },
});
