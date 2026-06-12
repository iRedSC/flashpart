/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authModel from "../authModel.js";
import type * as authUtils from "../authUtils.js";
import type * as captures from "../captures.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as listingJobs from "../listingJobs.js";
import type * as migrations from "../migrations.js";
import type * as productState from "../productState.js";
import type * as products from "../products.js";
import type * as settings from "../settings.js";
import type * as shopify from "../shopify.js";
import type * as shopifyClient from "../shopifyClient.js";
import type * as shopifyModel from "../shopifyModel.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authModel: typeof authModel;
  authUtils: typeof authUtils;
  captures: typeof captures;
  groups: typeof groups;
  http: typeof http;
  listingJobs: typeof listingJobs;
  migrations: typeof migrations;
  productState: typeof productState;
  products: typeof products;
  settings: typeof settings;
  shopify: typeof shopify;
  shopifyClient: typeof shopifyClient;
  shopifyModel: typeof shopifyModel;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
