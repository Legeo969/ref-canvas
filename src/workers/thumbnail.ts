import sharp from "sharp";

interface WorkerRequest {
  id: string;
  type: "convert";
  sourcePath: string;
  outputPath: string;
  width: number;
  height: number;
}

interface WorkerControl {
  type: "configure";
  concurrency: number;
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: WorkerRequest | WorkerControl }) => void): void;
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;

if (!parentPort) throw new Error("THUMBNAIL_WORKER_PARENT_MISSING");

parentPort.on("message", (event) => {
  const request = event.data;
  if (request.type === "configure") {
    sharp.concurrency(request.concurrency);
    return;
  }
  if (request.type !== "convert") return;
  void sharp(request.sourcePath, { animated: false, failOn: "none" })
    .rotate()
    .resize(request.width, request.height, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toFile(request.outputPath)
    .then((info) =>
      parentPort.postMessage({
        id: request.id,
        ok: true,
        size: info.size,
      }),
    )
    .catch((error: unknown) =>
      parentPort.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : "CONVERT_FAILED",
      }),
    );
});
