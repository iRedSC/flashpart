import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const productStatus = v.union(
  v.literal("imported"),
  v.literal("grouped"),
  v.literal("captured"),
  v.literal("processing"),
  v.literal("draftCreated"),
  v.literal("failed"),
  v.literal("blockedExistingSku"),
  v.literal("needsReview"),
);

export const duplicatePolicy = v.union(
  v.literal("blockExisting"),
  v.literal("updateExisting"),
);

export default defineSchema({
  users: defineTable({
    email: v.string(),
    createdAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  emailOtps: defineTable({
    email: v.string(),
    codeHash: v.string(),
    purpose: v.union(v.literal("passkey_setup"), v.literal("login")),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_email_purpose", ["email", "purpose"]),

  authChallenges: defineTable({
    userId: v.optional(v.id("users")),
    email: v.optional(v.string()),
    challenge: v.string(),
    purpose: v.union(v.literal("passkey_setup"), v.literal("login")),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_email", ["email"])
    .index("by_challenge", ["challenge"]),

  passkeys: defineTable({
    userId: v.id("users"),
    credentialId: v.string(),
    publicKey: v.string(),
    signCount: v.number(),
    transports: v.optional(v.array(v.string())),
    deviceName: v.optional(v.string()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_credential_id", ["credentialId"]),

  authSessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_token_hash", ["tokenHash"]),

  appSettings: defineTable({
    key: v.literal("singleton"),
    duplicatePolicy,
    shopifyConnectionStatus: v.optional(
      v.union(
        v.literal("disconnected"),
        v.literal("needsToken"),
        v.literal("connected"),
      ),
    ),
    shopifyShopDomain: v.optional(v.string()),
    shopifyTokenLastFour: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  shopifyConnections: defineTable({
    userId: v.id("users"),
    shopDomain: v.string(),
    accessToken: v.string(),
    scopes: v.array(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_shop_domain", ["shopDomain"])
    .index("by_user_shop_domain", ["userId", "shopDomain"])
    .index("by_active", ["isActive"]),

  shopifyOAuthStates: defineTable({
    userId: v.id("users"),
    shopDomain: v.string(),
    state: v.string(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_user", ["userId"])
    .index("by_shop_domain", ["shopDomain"]),

  products: defineTable({
    sku: v.string(),
    name: v.string(),
    price: v.number(),
    status: productStatus,
    duplicatePolicy,
    groupId: v.optional(v.id("groups")),
    captureId: v.optional(v.id("captures")),
    rawImageStorageId: v.optional(v.id("_storage")),
    processedImageUrl: v.optional(v.string()),
    shopifyProductId: v.optional(v.string()),
    shopifyStatus: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sku", ["sku"])
    .index("by_group", ["groupId"])
    .index("by_status", ["status"]),

  groups: defineTable({
    name: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("completed"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_status", ["status"]),

  captures: defineTable({
    productId: v.id("products"),
    groupId: v.id("groups"),
    rawImageStorageId: v.optional(v.id("_storage")),
    processedImageUrl: v.optional(v.string()),
    status: v.union(
      v.literal("uploaded"),
      v.literal("processing"),
      v.literal("processed"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_product", ["productId"])
    .index("by_group", ["groupId"]),

  listingJobs: defineTable({
    productId: v.id("products"),
    groupId: v.optional(v.id("groups")),
    captureId: v.optional(v.id("captures")),
    type: v.union(
      v.literal("processPhoto"),
      v.literal("createShopifyDraft"),
      v.literal("updateShopifyDraft"),
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    triggerRunId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_product", ["productId"])
    .index("by_status", ["status"]),
});
