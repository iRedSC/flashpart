import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  captureStatus,
  lastError,
  pendingOperation,
  productPhase,
} from "./productState";

export const duplicatePolicy = v.union(
  v.literal("blockExisting"),
  v.literal("updateExisting"),
);

export const shopifyPublishTarget = v.union(
  v.literal("draft"),
  v.literal("published"),
);

export const shopifyFileStatus = v.union(
  v.literal("uploaded"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
);

export const shopifyStatus = v.union(
  v.literal("draft"),
  v.literal("published"),
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
    shopifyPublishTarget: v.optional(shopifyPublishTarget),
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
    description: v.optional(v.string()),
    price: v.number(),
    phase: v.optional(productPhase),
    pendingOperation: v.optional(pendingOperation),
    needsPhotoReview: v.optional(v.boolean()),
    lastError: v.optional(lastError),
    groupId: v.optional(v.id("groups")),
    captureId: v.optional(v.id("captures")),
    shopifyFileId: v.optional(v.string()),
    shopifyFileStatus: v.optional(shopifyFileStatus),
    shopifyFileUrl: v.optional(v.string()),
    shopifyStagedResourceUrl: v.optional(v.string()),
    shopifyFileDeletedAt: v.optional(v.number()),
    shopifyProductId: v.optional(v.string()),
    shopifyProductHandle: v.optional(v.string()),
    shopifyVariantId: v.optional(v.string()),
    shopifyStatus: v.optional(shopifyStatus),
    sortOrder: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sku", ["sku"])
    .index("by_group", ["groupId"])
    .index("by_phase", ["phase"]),

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
    shopifyFileId: v.optional(v.string()),
    shopifyFileStatus: v.optional(shopifyFileStatus),
    shopifyFileUrl: v.optional(v.string()),
    shopifyStagedResourceUrl: v.optional(v.string()),
    shopifyFileDeletedAt: v.optional(v.number()),
    status: v.union(
      captureStatus,
      v.literal("uploaded"),
      v.literal("processing"),
      v.literal("processed"),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_product", ["productId"])
    .index("by_group", ["groupId"]),

  listingJobs: defineTable({
    productId: v.id("products"),
    userId: v.optional(v.id("users")),
    shopifyConnectionId: v.optional(v.id("shopifyConnections")),
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
    result: v.optional(v.any()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_product", ["productId"])
    .index("by_status", ["status"])
    .index("by_type_status", ["type", "status"]),
});
