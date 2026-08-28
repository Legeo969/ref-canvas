import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  isExcludedImportPath,
  type EnumeratedImportPath,
} from "../main/services/import-enumerator";

interface WorkerRequest {
  id: string;
  type: "start" | "ack" | "cancel";
  inputPaths?: string[];
  excludedRoots?: string[];
  batchId?: number;
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: WorkerRequest }) => void): void;
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error("IMPORT_ENUMERATOR_PARENT_MISSING");

const cancelled = new Set<string>();
const acknowledgements = new Map<string, () => void>();

async function enumerate(request: WorkerRequest): Promise<void> {
  const inputPaths = request.inputPaths ?? [];
  const excludedRoots = request.excludedRoots ?? [];
  let batch: EnumeratedImportPath[] = [];
  let batchId = 0;
  let discovered = 0;
  const flush = async () => {
    if (!batch.length) return;
    const items = batch;
    batch = [];
    batchId += 1;
    const key = `${request.id}:${batchId}`;
    const acknowledged = new Promise<void>((resolve) => acknowledgements.set(key, resolve));
    parentPort.postMessage({ id: request.id, type: "batch", batchId, items });
    await acknowledged;
  };
  try {
    for (const inputPath of inputPaths) {
      if (cancelled.has(request.id)) break;
      const resolved = path.resolve(inputPath);
      if (isExcludedImportPath(resolved, excludedRoots)) continue;
      const info = await stat(resolved);
      if (info.isFile()) {
        batch.push({ filename: resolved, sourceRoot: null });
        discovered += 1;
        if (batch.length === 512) await flush();
        continue;
      }
      if (!info.isDirectory()) continue;
      const directories = [resolved];
      for (let index = 0; index < directories.length; index += 1) {
        if (cancelled.has(request.id)) break;
        const directory = directories[index];
        if (isExcludedImportPath(directory, excludedRoots)) continue;
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          const filename = path.join(directory, entry.name);
          if (isExcludedImportPath(filename, excludedRoots)) continue;
          if (entry.isDirectory()) directories.push(filename);
          else if (entry.isFile()) {
            batch.push({ filename, sourceRoot: resolved });
            discovered += 1;
            if (batch.length === 512) await flush();
          }
        }
      }
    }
    if (!cancelled.has(request.id)) await flush();
    parentPort.postMessage({ id: request.id, type: "done", discovered });
  } catch (error) {
    parentPort.postMessage({
      id: request.id,
      type: "error",
      error: error instanceof Error ? error.message : "IMPORT_ENUMERATION_FAILED",
    });
  } finally {
    cancelled.delete(request.id);
    for (const [key, resolve] of acknowledgements) {
      if (!key.startsWith(`${request.id}:`)) continue;
      acknowledgements.delete(key);
      resolve();
    }
  }
}

parentPort.on("message", (event) => {
  const request = event.data;
  if (request.type === "start") {
    void enumerate(request);
  } else if (request.type === "ack" && request.batchId !== undefined) {
    const key = `${request.id}:${request.batchId}`;
    acknowledgements.get(key)?.();
    acknowledgements.delete(key);
  } else if (request.type === "cancel") {
    cancelled.add(request.id);
    for (const [key, resolve] of acknowledgements) {
      if (!key.startsWith(`${request.id}:`)) continue;
      acknowledgements.delete(key);
      resolve();
    }
  }
});
