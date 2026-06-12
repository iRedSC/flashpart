import { internalMutation } from "./_generated/server";
import { migrateLegacyProduct } from "./productState";

export const migrateProductsToPhase = internalMutation({
  args: {},
  handler: async (ctx) => {
    const products = await ctx.db.query("products").collect();
    let migrated = 0;

    for (const product of products) {
      const patch = migrateLegacyProduct(product);

      if (!patch) {
        continue;
      }

      await ctx.db.patch(product._id, patch);
      migrated += 1;
    }

    const captures = await ctx.db.query("captures").collect();

    for (const capture of captures) {
      const status = capture.status as string;
      let newStatus: "recorded" | "fileProcessing" | "ready" | "failed";

      switch (status) {
        case "fileProcessing":
        case "processing":
          newStatus = "fileProcessing";
          break;
        case "ready":
        case "processed":
          newStatus = "ready";
          break;
        case "failed":
          newStatus = "failed";
          break;
        default:
          newStatus = "recorded";
      }

      if (newStatus !== status) {
        await ctx.db.patch(capture._id, { status: newStatus });
      }
    }

    return { migrated };
  },
});
