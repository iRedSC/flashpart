import { httpRouter } from "convex/server";
import { handleShopifyCallback } from "./shopify";

const http = httpRouter();

http.route({
  path: "/shopify/callback",
  method: "GET",
  handler: handleShopifyCallback,
});

export default http;
