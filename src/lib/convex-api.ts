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
    assignProducts: deployedFunction<typeof api.groups.assignProducts>(
      "groups.js:assignProducts",
    ),
  },
  listingJobs: {
    list: deployedFunction<typeof api.listingJobs.list>("listingJobs.js:list"),
    enqueueCreateDrafts: deployedFunction<
      typeof api.listingJobs.enqueueCreateDrafts
    >("listingJobs.js:enqueueCreateDrafts"),
  },
  products: {
    list: deployedFunction<typeof api.products.list>("products.js:list"),
    seedSampleProducts: deployedFunction<
      typeof api.products.seedSampleProducts
    >("products.js:seedSampleProducts"),
    update: deployedFunction<typeof api.products.update>("products.js:update"),
    importProducts: deployedFunction<typeof api.products.importProducts>(
      "products.js:importProducts",
    ),
    removeMany: deployedFunction<typeof api.products.removeMany>(
      "products.js:removeMany",
    ),
    reorder: deployedFunction<typeof api.products.reorder>(
      "products.js:reorder",
    ),
  },
  settings: {
    get: deployedFunction<typeof api.settings.get>("settings.js:get"),
    setDuplicatePolicy: deployedFunction<
      typeof api.settings.setDuplicatePolicy
    >("settings.js:setDuplicatePolicy"),
    setShopifyPublishTarget: deployedFunction<
      typeof api.settings.setShopifyPublishTarget
    >("settings.js:setShopifyPublishTarget"),
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
    prepareFileUpload: deployedFunction<typeof api.shopify.prepareFileUpload>(
      "shopify.js:prepareFileUpload",
    ),
    finalizeFileUpload: deployedFunction<typeof api.shopify.finalizeFileUpload>(
      "shopify.js:finalizeFileUpload",
    ),
    deleteProductFile: deployedFunction<typeof api.shopify.deleteProductFile>(
      "shopify.js:deleteProductFile",
    ),
  },
};
