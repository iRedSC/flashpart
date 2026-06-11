import { logger, task, wait } from "@trigger.dev/sdk/v3";

type ListingPipelinePayload = {
  jobId: string;
  productId: string;
  captureId: string;
  sku: string;
  name: string;
  price: number;
  duplicatePolicy: "blockExisting" | "updateExisting";
};

export const processPhotoAndCreateDraft = task({
  id: "photo.process-and-create-draft",
  maxDuration: 600,
  run: async (payload: ListingPipelinePayload) => {
    logger.log("Starting photo/listing pipeline", {
      duplicatePolicy: payload.duplicatePolicy,
      jobId: payload.jobId,
      sku: payload.sku,
    });

    await wait.for({ seconds: 1 });

    logger.log("Photo touch-up stub complete", {
      captureId: payload.captureId,
      productId: payload.productId,
    });

    await wait.for({ seconds: 1 });

    logger.log("Shopify draft stub complete", {
      price: payload.price,
      productId: payload.productId,
      title: payload.name,
    });

    return {
      processedImageUrl: null,
      shopifyProductId: null,
      status: "stubbed",
    };
  },
});