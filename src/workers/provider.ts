import { GeometryProvider } from "../main/providers/geometry-provider";
import { HdrProvider } from "../main/providers/hdr-provider";
import { ImageProvider } from "../main/providers/image-provider";
import { VideoProvider } from "../main/providers/video-provider";
import { workerJobSchema } from "../main/platform/worker-protocol-validation";
import { assetKinds } from "../shared/contracts";
import type { ResourceProvider, WorkerJob } from "../shared/worker-protocol";
import { z } from "zod";

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error("PROVIDER_WORKER_PARENT_MISSING");

const providers = new Map([
  ["hdr-provider", new HdrProvider()],
  ["geometry-provider", new GeometryProvider()],
  ["video-provider", new VideoProvider()],
  ["image-provider", new ImageProvider()],
]);
const cancelled = new Set<string>();

const providerInputBase = z.object({
  path: z.string().min(1).max(32_768),
  kind: z.enum(assetKinds),
  extension: z.string().min(1).max(32),
});
const providerInputSchemas = {
  probe: providerInputBase.extend({ size: z.number().nonnegative() }),
  metadata: providerInputBase,
  thumbnail: providerInputBase.extend({
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    outputPath: z.string().min(1).max(32_768).optional(),
    channel: z.string().min(1).max(256).optional(),
  }),
  waveform: providerInputBase.extend({ samples: z.number().int().nonnegative() }),
  preview: providerInputBase.extend({ variant: z.string().min(1).max(128) }),
  convert: providerInputBase.extend({
    targetFormat: z.string().min(1).max(16),
    options: z.record(z.string(), z.unknown()),
  }),
} as const;

function postFailure(jobId: string, errorCode: string): void {
  parentPort?.postMessage({
    type: "update",
    update: {
      jobId,
      state: "failed",
      progress: 1,
      errorCode,
      error: errorCode,
    },
  });
}

function parseJob(message: unknown): WorkerJob | null {
  if (!message || typeof message !== "object") return null;
  const envelope = message as { type?: unknown; job?: unknown };
  if (envelope.type !== "job") return null;
  const parsed = workerJobSchema.safeParse(envelope.job);
  return parsed.success ? parsed.data : null;
}

async function dispatch(provider: ResourceProvider, job: WorkerJob): Promise<unknown> {
  const input = { ...job.options, path: job.inputPath };
  switch (job.operation) {
    case "probe":
      return provider.probe(providerInputSchemas.probe.parse(input));
    case "metadata":
      return provider.metadata(providerInputSchemas.metadata.parse(input));
    case "thumbnail":
      return provider.thumbnail(providerInputSchemas.thumbnail.parse(input));
    case "waveform":
      return provider.waveform(providerInputSchemas.waveform.parse(input));
    case "preview":
      return provider.preview(providerInputSchemas.preview.parse(input));
    case "convert":
      return provider.convert(providerInputSchemas.convert.parse(input));
  }
}

parentPort.on("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  const envelope = message as { type?: unknown; jobId?: unknown };
  if (envelope.type === "close") {
    process.exit(0);
  }
  if (envelope.type === "cancel" && typeof envelope.jobId === "string") {
    cancelled.add(envelope.jobId);
    return;
  }
  const job = parseJob(message);
  if (!job) return;
  const provider = providers.get(job.providerId);
  if (!provider) {
    postFailure(job.jobId, "PROVIDER_NOT_FOUND");
    return;
  }
  parentPort.postMessage({
    type: "update",
    update: {
      jobId: job.jobId,
      state: "running",
      progress: 0,
      errorCode: null,
      error: null,
    },
  });
  void (async () => {
    try {
      const result = await dispatch(provider, job);
      if (cancelled.has(job.jobId)) {
        cancelled.delete(job.jobId);
        return;
      }
      const data = z.record(z.string(), z.unknown()).parse(result);
      parentPort.postMessage({
        type: "result",
        result: { jobId: job.jobId, data },
      });
    } catch (error) {
      parentPort.postMessage({
        type: "update",
        update: {
          jobId: job.jobId,
          state: "failed",
          progress: 1,
          errorCode: "PROVIDER_FAILED",
          error: error instanceof Error ? error.message : "PROVIDER_FAILED",
        },
      });
    }
  })();
});
