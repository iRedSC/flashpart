import { makeFunctionReference } from "convex/server";
import type { FunctionReference } from "convex/server";
import type { api } from "../../convex/_generated/api";

type PublicFunctionReference<T> = T extends FunctionReference<
  infer Type,
  "public",
  infer Args,
  infer Return
>
  ? FunctionReference<Type, "public", Args, Return>
  : never;

function deployedFunction<T>(
  identifier: string,
): PublicFunctionReference<T> {
  return makeFunctionReference(identifier) as PublicFunctionReference<T>;
}

export const convexApi = {
  auth: {
    requestEmailOtp: deployedFunction<typeof api.auth.requestEmailOtp>(
      "auth.js:requestEmailOtp",
    ),
    verifyOtpAndStartPasskeySetup: deployedFunction<
      typeof api.auth.verifyOtpAndStartPasskeySetup
    >("auth.js:verifyOtpAndStartPasskeySetup"),
    completePasskeySetup: deployedFunction<typeof api.auth.completePasskeySetup>(
      "auth.js:completePasskeySetup",
    ),
    startPasskeySignIn: deployedFunction<typeof api.auth.startPasskeySignIn>(
      "auth.js:startPasskeySignIn",
    ),
    completePasskeySignIn: deployedFunction<
      typeof api.auth.completePasskeySignIn
    >("auth.js:completePasskeySignIn"),
  },
  captures: {
    record: deployedFunction<typeof api.captures.record>("captures.js:record"),
  },
  groups: {
    list: deployedFunction<typeof api.groups.list>("groups.js:list"),
    create: deployedFunction<typeof api.groups.create>("groups.js:create"),
    assignFirstUngrouped: deployedFunction<
      typeof api.groups.assignFirstUngrouped
    >("groups.js:assignFirstUngrouped"),
  },
  listingJobs: {
    list: deployedFunction<typeof api.listingJobs.list>("listingJobs.js:list"),
  },
  products: {
    list: deployedFunction<typeof api.products.list>("products.js:list"),
    seedSampleProducts: deployedFunction<
      typeof api.products.seedSampleProducts
    >("products.js:seedSampleProducts"),
    update: deployedFunction<typeof api.products.update>("products.js:update"),
  },
  settings: {
    get: deployedFunction<typeof api.settings.get>("settings.js:get"),
    setDuplicatePolicy: deployedFunction<
      typeof api.settings.setDuplicatePolicy
    >("settings.js:setDuplicatePolicy"),
  },
  shopify: {
    currentConnection: deployedFunction<typeof api.shopify.currentConnection>(
      "shopify.js:currentConnection",
    ),
    disconnect: deployedFunction<typeof api.shopify.disconnect>(
      "shopify.js:disconnect",
    ),
    startShopifyInstall: deployedFunction<
      typeof api.shopify.startShopifyInstall
    >("shopify.js:startShopifyInstall"),
  },
};
