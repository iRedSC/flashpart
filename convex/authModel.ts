import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const storeEmailOtp = internalMutation({
  args: {
    email: v.string(),
    codeHash: v.string(),
    purpose: v.union(v.literal("passkey_setup"), v.literal("login")),
    expiresAt: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("emailOtps", args);
  },
});

export const verifyOtpAndCreateUser = internalMutation({
  args: { email: v.string(), codeHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const otp = await ctx.db
      .query("emailOtps")
      .withIndex("by_email_purpose", (q) =>
        q.eq("email", args.email).eq("purpose", "passkey_setup"),
      )
      .order("desc")
      .first();

    if (!otp || otp.consumedAt || otp.expiresAt < args.now) {
      throw new ConvexError("That code has expired. Request a new one.");
    }

    if (otp.codeHash !== args.codeHash) {
      throw new ConvexError("That code is not correct.");
    }

    await ctx.db.patch(otp._id, { consumedAt: args.now });

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (existingUser) {
      return { userId: existingUser._id, email: existingUser.email };
    }

    const userId = await ctx.db.insert("users", {
      email: args.email,
      createdAt: args.now,
    });

    return { userId, email: args.email };
  },
});

export const storeChallenge = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    email: v.optional(v.string()),
    challenge: v.string(),
    purpose: v.union(v.literal("passkey_setup"), v.literal("login")),
    expiresAt: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("authChallenges", args);
  },
});

export const getChallengeById = internalQuery({
  args: {
    challengeId: v.id("authChallenges"),
    purpose: v.union(v.literal("passkey_setup"), v.literal("login")),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get(args.challengeId);

    if (
      !challenge ||
      challenge.purpose !== args.purpose ||
      challenge.consumedAt ||
      challenge.expiresAt < args.now
    ) {
      return null;
    }

    return challenge;
  },
});

export const consumeChallenge = internalMutation({
  args: { challengeId: v.id("authChallenges"), now: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.challengeId, { consumedAt: args.now });
  },
});

export const getUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (!user) {
      return null;
    }

    return { userId: user._id, email: user.email };
  },
});

export const getUserPasskeys = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("passkeys")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const getPasskeyByCredentialId = internalQuery({
  args: { credentialId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("passkeys")
      .withIndex("by_credential_id", (q) =>
        q.eq("credentialId", args.credentialId),
      )
      .unique();
  },
});

export const storePasskeyAndSession = internalMutation({
  args: {
    userId: v.id("users"),
    credentialId: v.string(),
    publicKey: v.string(),
    signCount: v.number(),
    transports: v.optional(v.array(v.string())),
    sessionTokenHash: v.string(),
    sessionExpiresAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);

    if (!user) {
      throw new ConvexError("User not found.");
    }

    const existingPasskey = await ctx.db
      .query("passkeys")
      .withIndex("by_credential_id", (q) =>
        q.eq("credentialId", args.credentialId),
      )
      .unique();

    if (!existingPasskey) {
      await ctx.db.insert("passkeys", {
        userId: args.userId,
        credentialId: args.credentialId,
        publicKey: args.publicKey,
        signCount: args.signCount,
        transports: args.transports,
        createdAt: args.now,
      });
    }

    await ctx.db.insert("authSessions", {
      userId: args.userId,
      tokenHash: args.sessionTokenHash,
      expiresAt: args.sessionExpiresAt,
      createdAt: args.now,
    });

    return { userId: args.userId, email: user.email };
  },
});

export const updatePasskeyAndCreateSession = internalMutation({
  args: {
    credentialId: v.string(),
    signCount: v.number(),
    sessionTokenHash: v.string(),
    sessionExpiresAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const passkey = await ctx.db
      .query("passkeys")
      .withIndex("by_credential_id", (q) =>
        q.eq("credentialId", args.credentialId),
      )
      .unique();

    if (!passkey) {
      throw new ConvexError("Passkey not found.");
    }

    const user = await ctx.db.get(passkey.userId);

    if (!user) {
      throw new ConvexError("User not found.");
    }

    await ctx.db.patch(passkey._id, {
      signCount: args.signCount,
      lastUsedAt: args.now,
    });
    await ctx.db.insert("authSessions", {
      userId: passkey.userId,
      tokenHash: args.sessionTokenHash,
      expiresAt: args.sessionExpiresAt,
      createdAt: args.now,
    });
    await ctx.db.patch(passkey.userId, { lastLoginAt: args.now });

    return { userId: passkey.userId, email: user.email };
  },
});

export const getSession = internalQuery({
  args: { tokenHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();

    if (!session || session.revokedAt || session.expiresAt < args.now) {
      return null;
    }

    const user = await ctx.db.get(session.userId);

    if (!user) {
      return null;
    }

    return { session, user };
  },
});
