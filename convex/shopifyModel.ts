import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireSessionUser } from "./authUtils";

export const createOAuthState = internalMutation({
  args: {
    sessionToken: v.string(),
    shopDomain: v.string(),
    state: v.string(),
    expiresAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireSessionUser(ctx, args.sessionToken);

    await ctx.db.insert("shopifyOAuthStates", {
      userId,
      shopDomain: args.shopDomain,
      state: args.state,
      expiresAt: args.expiresAt,
      createdAt: args.now,
    });
  },
});

export const storeConnectionFromOAuth = internalMutation({
  args: {
    state: v.string(),
    shopDomain: v.string(),
    accessToken: v.string(),
    scopes: v.array(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const oauthState = await ctx.db
      .query("shopifyOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();

    if (!oauthState || oauthState.consumedAt || oauthState.expiresAt < args.now) {
      throw new ConvexError("Shopify connection expired. Try again.");
    }

    if (oauthState.shopDomain !== args.shopDomain) {
      throw new ConvexError("Shopify callback did not match the install request.");
    }

    const existingConnection = await ctx.db
      .query("shopifyConnections")
      .withIndex("by_user_shop_domain", (q) =>
        q.eq("userId", oauthState.userId).eq("shopDomain", args.shopDomain),
      )
      .unique();
    const connection = {
      accessToken: args.accessToken,
      scopes: args.scopes,
      isActive: true,
      updatedAt: args.now,
    };

    if (existingConnection) {
      await ctx.db.patch(existingConnection._id, connection);
    } else {
      await ctx.db.insert("shopifyConnections", {
        userId: oauthState.userId,
        shopDomain: args.shopDomain,
        ...connection,
        createdAt: args.now,
      });
    }

    await ctx.db.patch(oauthState._id, { consumedAt: args.now });
  },
});

export const currentActiveConnection = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireSessionUser(ctx, args.sessionToken);
    const connections = await ctx.db
      .query("shopifyConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return connections
      .filter((connection) => connection.isActive)
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .at(0) ?? null;
  },
});
