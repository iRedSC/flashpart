"use node";

import crypto from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { makeFunctionReference } from "convex/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authModel = {
  storeEmailOtp: makeFunctionReference("authModel.js:storeEmailOtp") as any,
  verifyOtpAndCreateUser: makeFunctionReference(
    "authModel.js:verifyOtpAndCreateUser",
  ) as any,
  getUserByEmail: makeFunctionReference("authModel.js:getUserByEmail") as any,
  getUserPasskeys: makeFunctionReference("authModel.js:getUserPasskeys") as any,
  storeChallenge: makeFunctionReference("authModel.js:storeChallenge") as any,
  getChallengeById: makeFunctionReference("authModel.js:getChallengeById") as any,
  storePasskeyAndSession: makeFunctionReference(
    "authModel.js:storePasskeyAndSession",
  ) as any,
  consumeChallenge: makeFunctionReference("authModel.js:consumeChallenge") as any,
  getPasskeyByCredentialId: makeFunctionReference(
    "authModel.js:getPasskeyByCredentialId",
  ) as any,
  updatePasskeyAndCreateSession: makeFunctionReference(
    "authModel.js:updatePasskeyAndCreateSession",
  ) as any,
};

const OTP_MINUTES = 10;
const CHALLENGE_MINUTES = 5;
const SESSION_DAYS = 30;

type ExcludeCredential = NonNullable<
  Parameters<typeof generateRegistrationOptions>[0]["excludeCredentials"]
>[number];
type AllowCredential = NonNullable<
  Parameters<typeof generateAuthenticationOptions>[0]["allowCredentials"]
>[number];

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const hashValue = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
const randomCode = () =>
  crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
const randomToken = () => crypto.randomBytes(32).toString("base64url");

const getWebAuthnConfig = (origin: string) => {
  const expectedOrigin = process.env.AUTH_ORIGIN ?? origin;
  const rpID = process.env.AUTH_RP_ID ?? new URL(expectedOrigin).hostname;

  return { expectedOrigin, rpID };
};

const sendOtpEmail = async (email: string, code: string) => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new ConvexError("Missing RESEND_API_KEY.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL_FROM ?? "Flashpart <flashpart@example.com>",
      to: email,
      subject: "Your Flashpart sign-in code",
      text: `Your Flashpart code is ${code}. It expires in ${OTP_MINUTES} minutes.`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend failed: ${await response.text()}`);
  }
};

export const requestEmailOtp = action({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const code = randomCode();
    const now = Date.now();

    await ctx.runMutation(authModel.storeEmailOtp, {
      email,
      codeHash: hashValue(code),
      purpose: "passkey_setup",
      expiresAt: now + OTP_MINUTES * 60 * 1000,
      createdAt: now,
    });

    await sendOtpEmail(email, code);

    return { email };
  },
});

export const verifyOtpAndStartPasskeySetup = action({
  args: { email: v.string(), code: v.string(), origin: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const now = Date.now();
    const user = await ctx.runMutation(
      authModel.verifyOtpAndCreateUser,
      {
        email,
        codeHash: hashValue(args.code.trim()),
        now,
      },
    );
    const passkeys = (await ctx.runQuery(authModel.getUserPasskeys, {
      userId: user.userId,
    })) as Doc<"passkeys">[];
    const { rpID } = getWebAuthnConfig(args.origin);
    const options = await generateRegistrationOptions({
      rpName: "Flashpart",
      rpID,
      userName: email,
      userDisplayName: email,
      userID: new TextEncoder().encode(user.userId),
      attestationType: "none",
      excludeCredentials: passkeys.map((passkey): ExcludeCredential => ({
        id: passkey.credentialId,
        transports: passkey.transports as ExcludeCredential["transports"],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });
    const challengeId = await ctx.runMutation(
      authModel.storeChallenge,
      {
        userId: user.userId,
        email,
        challenge: options.challenge,
        purpose: "passkey_setup",
        expiresAt: now + CHALLENGE_MINUTES * 60 * 1000,
        createdAt: now,
      },
    );

    return { options, challengeId };
  },
});

export const completePasskeySetup = action({
  args: { challengeId: v.id("authChallenges"), response: v.any(), origin: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const challenge = await ctx.runQuery(authModel.getChallengeById, {
      challengeId: args.challengeId,
      purpose: "passkey_setup",
      now,
    });

    if (!challenge?.userId) {
      throw new Error("Passkey setup challenge expired.");
    }

    const { expectedOrigin, rpID } = getWebAuthnConfig(args.origin);
    const verification = await verifyRegistrationResponse({
      response: args.response as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified) {
      throw new Error("Could not verify this passkey.");
    }

    const sessionToken = randomToken();
    const { credential } = verification.registrationInfo;
    const user = await ctx.runMutation(
      authModel.storePasskeyAndSession,
      {
        userId: challenge.userId,
        credentialId: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        signCount: credential.counter,
        transports: (args.response as RegistrationResponseJSON).response.transports,
        sessionTokenHash: hashValue(sessionToken),
        sessionExpiresAt: now + SESSION_DAYS * 24 * 60 * 60 * 1000,
        now,
      },
    );

    await ctx.runMutation(authModel.consumeChallenge, {
      challengeId: args.challengeId,
      now,
    });

    return { ...user, sessionToken };
  },
});

export const startPasskeySignIn = action({
  args: { origin: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { rpID } = getWebAuthnConfig(args.origin);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
    });
    const challengeId = await ctx.runMutation(
      authModel.storeChallenge,
      {
        challenge: options.challenge,
        purpose: "login",
        expiresAt: now + CHALLENGE_MINUTES * 60 * 1000,
        createdAt: now,
      },
    );

    return { options, challengeId };
  },
});

export const startPasskeySignInForEmail = action({
  args: { email: v.string(), origin: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const now = Date.now();
    const user = await ctx.runQuery(authModel.getUserByEmail, { email });

    if (!user) {
      return { available: false as const };
    }

    const passkeys = (await ctx.runQuery(authModel.getUserPasskeys, {
      userId: user.userId,
    })) as Doc<"passkeys">[];

    if (passkeys.length === 0) {
      return { available: false as const };
    }

    const { rpID } = getWebAuthnConfig(args.origin);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
      allowCredentials: passkeys.map((passkey): AllowCredential => ({
        id: passkey.credentialId,
        transports: passkey.transports as AllowCredential["transports"],
      })),
    });
    const challengeId = await ctx.runMutation(
      authModel.storeChallenge,
      {
        userId: user.userId,
        email,
        challenge: options.challenge,
        purpose: "login",
        expiresAt: now + CHALLENGE_MINUTES * 60 * 1000,
        createdAt: now,
      },
    );

    return { available: true as const, options, challengeId };
  },
});

export const completePasskeySignIn = action({
  args: { challengeId: v.id("authChallenges"), response: v.any(), origin: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const credentialResponse = args.response as AuthenticationResponseJSON;
    const [challenge, passkey] = await Promise.all([
      ctx.runQuery(authModel.getChallengeById, {
        challengeId: args.challengeId,
        purpose: "login",
        now,
      }),
      ctx.runQuery(authModel.getPasskeyByCredentialId, {
        credentialId: credentialResponse.id,
      }),
    ]);

    if (!challenge || !passkey) {
      throw new Error("Passkey sign-in challenge expired.");
    }

    if (challenge.userId && passkey.userId !== challenge.userId) {
      throw new Error("Passkey does not match this account.");
    }

    const { expectedOrigin, rpID } = getWebAuthnConfig(args.origin);
    const verification = await verifyAuthenticationResponse({
      response: credentialResponse,
      expectedChallenge: challenge.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.signCount,
        transports: passkey.transports,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      throw new Error("Could not verify this passkey.");
    }

    const sessionToken = randomToken();
    const user = await ctx.runMutation(
      authModel.updatePasskeyAndCreateSession,
      {
        credentialId: passkey.credentialId,
        signCount: verification.authenticationInfo.newCounter,
        sessionTokenHash: hashValue(sessionToken),
        sessionExpiresAt: now + SESSION_DAYS * 24 * 60 * 60 * 1000,
        now,
      },
    );

    await ctx.runMutation(authModel.consumeChallenge, {
      challengeId: args.challengeId,
      now,
    });

    return { ...user, sessionToken };
  },
});
