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
    verifyInviteCode: deployedFunction<typeof api.auth.verifyInviteCode>(
      "auth.js:verifyInviteCode",
    ),
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
    startPasskeySignInForEmail: deployedFunction<
      typeof api.auth.startPasskeySignInForEmail
    >("auth.js:startPasskeySignInForEmail"),
    completePasskeySignIn: deployedFunction<
      typeof api.auth.completePasskeySignIn
    >("auth.js:completePasskeySignIn"),
    createPreviewAutologinSession: deployedFunction<
      typeof api.auth.createPreviewAutologinSession
    >("auth.js:createPreviewAutologinSession"),
  },
  captures: {
    record: deployedFunction<typeof api.captures.record>("captures.js:record"),
    recordConvexCapture: deployedFunction<
      typeof api.captures.recordConvexCapture
    >("captures.js:recordConvexCapture"),
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
    archive: deployedFunction<typeof api.groups.archive>("groups.js:archive"),
    unarchive: deployedFunction<typeof api.groups.unarchive>(
      "groups.js:unarchive",
    ),
    remove: deployedFunction<typeof api.groups.remove>("groups.js:remove"),
  },
  listingJobs: {
    list: deployedFunction<typeof api.listingJobs.list>("listingJobs.js:list"),
    enqueueCreateDrafts: deployedFunction<
      typeof api.listingJobs.enqueueCreateDrafts
    >("listingJobs.js:enqueueCreateDrafts"),
  },
  photoAi: {
    approveAiPhoto: deployedFunction<typeof api.photoAi.approveAiPhoto>(
      "photoAi.js:approveAiPhoto",
    ),
    approvePhoto: deployedFunction<typeof api.photoAi.approvePhoto>(
      "photoAi.js:approvePhoto",
    ),
    regenerate: deployedFunction<typeof api.photoAi.regenerate>(
      "photoAi.js:regenerate",
    ),
    regenerateForPhoto: deployedFunction<typeof api.photoAi.regenerateForPhoto>(
      "photoAi.js:regenerateForPhoto",
    ),
  },
  photoGc: {
    runPhotoStorageGc: deployedFunction<typeof api.photoGc.runPhotoStorageGc>(
      "photoGc.js:runPhotoStorageGc",
    ),
  },
  productPhotos: {
    listByProduct: deployedFunction<typeof api.productPhotos.listByProduct>(
      "productPhotos.js:listByProduct",
    ),
    listByProductKind: deployedFunction<
      typeof api.productPhotos.listByProductKind
    >("productPhotos.js:listByProductKind"),
    listForProducts: deployedFunction<typeof api.productPhotos.listForProducts>(
      "productPhotos.js:listForProducts",
    ),
    generateUploadUrl: deployedFunction<
      typeof api.productPhotos.generateUploadUrl
    >("productPhotos.js:generateUploadUrl"),
    createOriginalFromUpload: deployedFunction<
      typeof api.productPhotos.createOriginalFromUpload
    >("productPhotos.js:createOriginalFromUpload"),
    setSortOrder: deployedFunction<typeof api.productPhotos.setSortOrder>(
      "productPhotos.js:setSortOrder",
    ),
    deletePhoto: deployedFunction<typeof api.productPhotos.deletePhoto>(
      "productPhotos.js:deletePhoto",
    ),
    markAiGenerating: deployedFunction<
      typeof api.productPhotos.markAiGenerating
    >("productPhotos.js:markAiGenerating"),
    markAiReady: deployedFunction<typeof api.productPhotos.markAiReady>(
      "productPhotos.js:markAiReady",
    ),
    markAiFailed: deployedFunction<typeof api.productPhotos.markAiFailed>(
      "productPhotos.js:markAiFailed",
    ),
    approveAiPhoto: deployedFunction<typeof api.productPhotos.approveAiPhoto>(
      "productPhotos.js:approveAiPhoto",
    ),
    markPromoted: deployedFunction<typeof api.productPhotos.markPromoted>(
      "productPhotos.js:markPromoted",
    ),
    clearStorageId: deployedFunction<typeof api.productPhotos.clearStorageId>(
      "productPhotos.js:clearStorageId",
    ),
  },
  products: {
    list: deployedFunction<typeof api.products.list>("products.js:list"),
    update: deployedFunction<typeof api.products.update>("products.js:update"),
    create: deployedFunction<typeof api.products.create>("products.js:create"),
    importProducts: deployedFunction<typeof api.products.importProducts>(
      "products.js:importProducts",
    ),
    removeMany: deployedFunction<typeof api.products.removeMany>(
      "products.js:removeMany",
    ),
    archiveMany: deployedFunction<typeof api.products.archiveMany>(
      "products.js:archiveMany",
    ),
    unarchiveMany: deployedFunction<typeof api.products.unarchiveMany>(
      "products.js:unarchiveMany",
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
    setAutoArchiveComplete: deployedFunction<
      typeof api.settings.setAutoArchiveComplete
    >("settings.js:setAutoArchiveComplete"),
    setAutoArchiveCompleteGroups: deployedFunction<
      typeof api.settings.setAutoArchiveCompleteGroups
    >("settings.js:setAutoArchiveCompleteGroups"),
    setShopifyPublishTarget: deployedFunction<
      typeof api.settings.setShopifyPublishTarget
    >("settings.js:setShopifyPublishTarget"),
    setShopifyProductType: deployedFunction<
      typeof api.settings.setShopifyProductType
    >("settings.js:setShopifyProductType"),
    setShopifyDefaultTags: deployedFunction<
      typeof api.settings.setShopifyDefaultTags
    >("settings.js:setShopifyDefaultTags"),
    setAiImageDefaultPrompt: deployedFunction<
      typeof api.settings.setAiImageDefaultPrompt
    >("settings.js:setAiImageDefaultPrompt"),
    setAiImageModel: deployedFunction<typeof api.settings.setAiImageModel>(
      "settings.js:setAiImageModel",
    ),
    setAiImageEditStrength: deployedFunction<
      typeof api.settings.setAiImageEditStrength
    >("settings.js:setAiImageEditStrength"),
    setMaxProductPhotos: deployedFunction<
      typeof api.settings.setMaxProductPhotos
    >("settings.js:setMaxProductPhotos"),
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
    promotePhotoToShopify: deployedFunction<
      typeof api.shopify.promotePhotoToShopify
    >("shopify.js:promotePhotoToShopify"),
    deleteProductPhoto: deployedFunction<typeof api.shopify.deleteProductPhoto>(
      "shopify.js:deleteProductPhoto",
    ),
    deleteProductFile: deployedFunction<typeof api.shopify.deleteProductFile>(
      "shopify.js:deleteProductFile",
    ),
  },
};
