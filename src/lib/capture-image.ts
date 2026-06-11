export function canvasToFile(
  canvas: HTMLCanvasElement,
  fileName: string,
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Photo could not be processed. Please try again."));
          return;
        }

        resolve(
          new File([blob], fileName, {
            lastModified: Date.now(),
            type: "image/jpeg",
          }),
        );
      },
      "image/jpeg",
      0.92,
    );
  });
}

export async function cropImageFileToSquare(file: File): Promise<File> {
  const imageUrl = URL.createObjectURL(file);
  const image = new Image();

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("Photo could not be loaded. Please try again."));
      image.src = imageUrl;
    });

    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - sourceSize) / 2;
    const sourceY = (image.naturalHeight - sourceSize) / 2;
    const canvas = document.createElement("canvas");

    canvas.width = sourceSize;
    canvas.height = sourceSize;
    canvas
      .getContext("2d")
      ?.drawImage(
        image,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        sourceSize,
        sourceSize,
      );

    return await canvasToFile(
      canvas,
      `${file.name.replace(/\.[^.]+$/, "")}.jpg`,
    );
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
