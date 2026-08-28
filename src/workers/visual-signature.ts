import sharp from "sharp";
import { imageVisualSignature } from "../main/services/visual-signature-service";

interface WorkerRequest {
  id: string;
  type: "read";
  filename: string;
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error("VISUAL_SIGNATURE_WORKER_PARENT_MISSING");

// The worker is deliberately serial. This bounds libvips memory and isolates a
// malformed image or native addon failure from the Electron main process.
sharp.cache(false);
sharp.concurrency(1);

parentPort.on("message", (event) => {
  const value = event.data;
  if (!value || typeof value !== "object") return;
  const request = value as Partial<WorkerRequest>;
  if (
    request.type !== "read" ||
    typeof request.id !== "string" ||
    typeof request.filename !== "string"
  ) return;
  void imageVisualSignature(request.filename)
    .then((signature) => {
      parentPort.postMessage({ id: request.id, ok: true, signature });
    })
    .catch((error: unknown) => {
      parentPort.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : "VISUAL_SIGNATURE_FAILED",
      });
    });
});
