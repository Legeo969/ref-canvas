import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { z } from "zod";
import path from "node:path";
import type { UserMetadataPatch } from "../../shared/contracts";
import { assetKindForExtension } from "../../shared/asset-kind";
import type { RefCanvasDatabase } from "../persistence/database";
import type { LibraryService } from "../services/library-service";
import type { MountService } from "../services/mount-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import {
  invokeConvert,
  invokeProbe,
  invokeThumbnail,
  type ProviderRegistry,
} from "../platform/provider-registry";
import type { ThumbnailWorkerClient } from "../platform/thumbnail-worker-client";
import type { PreviewTokenRegistry } from "../platform/refbrowse";
import { extractVideoFrame } from "../services/media/ffmpeg-tools";
import { detectSequencesInDirectory } from "../services/media/sequence-service";
import { idSchema, pathSchema } from "./schemas";

interface ResourcesIpcDependencies {
  getDatabase(): RefCanvasDatabase;
  getLibrary(): LibraryService;
  getMountService(): MountService;
  getProviderRegistry(): ProviderRegistry;
  getThumbnailWorker(): ThumbnailWorkerClient | null;
  getThumbnailCacheDirectory(): string;
  previewTokens: PreviewTokenRegistry;
}

/**
 * §13.4 新增 API：mounts / metadata / collections refs / media / providers。
 * 与既有 library/filesystem 命名空间并存，逐步替换旧入口。
 */
export function registerResourcesIpc(
  ipc: SecureIpcRegistrar,
  dependencies: ResourcesIpcDependencies,
): void {
  const database = () => dependencies.getDatabase();
  const library = () => dependencies.getLibrary();

  // --- mounts（计划 §7.2 / §13.4）---

  ipc.handle("mounts:list", () => database().listMountRoots());
  ipc.handle("mounts:add", async (mountPath) => {
    const resolved = path.resolve(pathSchema.parse(mountPath));
    const existing = database()
      .listMountRoots()
      .find((item) => item.path === resolved);
    if (existing) return existing;
    // watch root 即挂载根（§7.2）：注册后启动监视，不复制任何文件。
    const watchRoot = await library().addWatchRoot(resolved);
    return database().listMountRoots().find((item) => item.id === watchRoot.id)!;
  });
  ipc.handle("mounts:remove", async (mountId) => {
    const parsedId = idSchema.parse(mountId);
    await library().removeWatchRoot(parsedId);
    // 移除 mount_roots 记录；删除/离线由状态语义决定，不触碰磁盘文件。
    database().deleteMountRoot(parsedId);
  });
  ipc.handle("mounts:reconnect", async (mountId) => {
    const parsedId = idSchema.parse(mountId);
    const state = await dependencies.getMountService().refreshMount(parsedId);
    const mount = database().listMountRoots().find((item) => item.id === parsedId);
    if (!mount) throw new Error("MOUNT_NOT_FOUND");
    if (state === "online") {
      const root = database().listWatchRoots().find((item) => item.id === parsedId);
      if (root) void library().reconcileRoots(root.id);
    }
    return mount;
  });

  // --- metadata（计划 §7.2 / §13.4）---

  ipc.handle("metadata:ensure", (filename) =>
    library().materializePath(path.resolve(pathSchema.parse(filename))),
  );
  ipc.handle("metadata:patch", (assetId, patch) => {
    const parsedId = idSchema.parse(assetId);
    const parsed = z
      .object({
        tags: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
        rating: z.number().int().min(0).max(5).optional(),
        notes: z.string().max(10_000).optional(),
      })
      .parse(patch) as UserMetadataPatch;
    if (parsed.tags !== undefined) {
      database().setAssetTags(parsedId, parsed.tags);
    }
    const next = database().updateAsset(parsedId, {
      rating: parsed.rating,
      notes: parsed.notes,
    });
    return next;
  });

  // --- collections refs（计划 §7.2 / §13.4）---

  ipc.handle("collections:add-references", async (collectionId, filenames) => {
    const parsedId = idSchema.parse(collectionId);
    const paths = z.array(pathSchema).max(10_000).parse(filenames);
    let added = 0;
    for (const filename of paths) {
      const resolved = path.resolve(filename);
      // 未入库文件先建立索引（§7.1 磁盘唯一真相），再建立 path+fingerprint 引用。
      await library().materializePath(resolved);
      const ref = database().resolveIdentityRef(resolved);
      if (!ref) continue;
      database().addCollectionRef({
        collectionId: parsedId,
        mountId: ref.mountId,
        relativePath: ref.relativePath,
        fingerprint: ref.fingerprint,
      });
      added += 1;
    }
    return added;
  });
  ipc.handle("collections:remove-references", (collectionId, filenames) => {
    const parsedId = idSchema.parse(collectionId);
    const paths = z.array(pathSchema).max(10_000).parse(filenames);
    const refs = paths
      .map((filename) => database().resolveIdentityRef(path.resolve(filename)))
      .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
      .map((ref) => ({ mountId: ref.mountId, relativePath: ref.relativePath }));
    return database().removeCollectionRefs(parsedId, refs);
  });
  ipc.handle("collections:list-references", (collectionId) =>
    database().listCollectionRefs(idSchema.parse(collectionId)),
  );

  // --- media（计划 §9 / §13.4）---

  ipc.handle("media:probe", async (filename) => {
    const resolved = path.resolve(pathSchema.parse(filename));
    const extension = path.extname(resolved).replace(/^\./, "").toLowerCase();
    const { result } = await invokeProbe(
      dependencies.getProviderRegistry(),
      {
        path: resolved,
        kind: assetKindForExtension(extension),
        extension,
        size: 0,
      },
    );
    return result;
  });
  ipc.handle("media:thumbnail", async (filename, options) => {
    const resolved = path.resolve(pathSchema.parse(filename));
    const extension = path.extname(resolved).replace(/^\./, "").toLowerCase();
    const parsed =
      z
        .object({
          width: z.number().int().min(16).max(8_192).optional(),
          height: z.number().int().min(16).max(8_192).optional(),
        })
        .optional()
        .parse(options) ?? {};
    const cacheDirectory = dependencies.getThumbnailCacheDirectory();
    if (!cacheDirectory) throw new Error("THUMBNAIL_CACHE_UNAVAILABLE");
    const target = path.join(
      cacheDirectory,
      `media-${thumbnailIdForPath(resolved)}.png`,
    );
    const kind = assetKindForExtension(extension);
    // 阶段 3：EXR/HDR 走 hdr-provider（display transform），视频走
    // video-provider（ffmpeg poster 帧）；其余走 sharp worker。
    if (extension === "exr" || extension === "hdr" || kind === "video") {
      const { result } = await invokeThumbnail(
        dependencies.getProviderRegistry(),
        {
          path: resolved,
          kind,
          extension,
          width: parsed.width ?? 480,
          height: parsed.height ?? 320,
          outputPath: target,
        },
      );
      return {
        path: result.path,
        width: result.width,
        height: result.height,
      };
    }
    const worker = dependencies.getThumbnailWorker();
    if (!worker) throw new Error("THUMBNAIL_WORKER_UNAVAILABLE");
    await worker.convert(resolved, target, undefined, {
      width: parsed.width ?? 480,
      height: parsed.height ?? 320,
    });
    return {
      path: target,
      width: parsed.width ?? 480,
      height: parsed.height ?? 320,
    };
  });
  /**
   * §9.3：视频/图片序列精确取帧（frame step 不依赖 HTML video seek）。
   * ffmpeg -ss + accurate_seek 按毫秒时间戳提取，输出缓存并签发 token。
   */
  ipc.handle("media:frame", async (filename, options) => {
    const resolved = path.resolve(pathSchema.parse(filename));
    const parsed = z
      .object({
        timeMs: z.number().min(0).max(86_400_000).default(0),
        width: z.number().int().min(16).max(8_192).optional(),
        height: z.number().int().min(16).max(8_192).optional(),
      })
      .parse(options ?? {});
    const cacheDirectory = dependencies.getThumbnailCacheDirectory();
    if (!cacheDirectory) throw new Error("THUMBNAIL_CACHE_UNAVAILABLE");
    const signature = createHash("sha256")
      .update(
        `${path.normalize(resolved)}:${Math.round(parsed.timeMs)}:${parsed.width ?? 960}:${parsed.height ?? 540}`,
      )
      .digest("hex")
      .slice(0, 20);
    const target = path.join(cacheDirectory, `frame-${signature}.png`);
    const existing = await stat(target).catch(() => null);
    if (!existing) {
      await extractVideoFrame(resolved, parsed.timeMs, target, {
        width: parsed.width ?? 960,
        height: parsed.height ?? 540,
      });
    }
    const token = dependencies.previewTokens.tokenFor(target);
    return {
      source: `refbrowse://preview/${token}`,
      path: target,
      timeMs: parsed.timeMs,
    };
  });
  ipc.handle("media:preview", (filename) => {
    const resolved = path.resolve(pathSchema.parse(filename));
    const token = dependencies.previewTokens.tokenFor(resolved);
    return {
      source: `refbrowse://preview/${token}`,
      mimeType: mimeTypeForPath(resolved),
    };
  });
  ipc.handle("media:convert", async (filename, targetFormat) => {
    const resolved = path.resolve(pathSchema.parse(filename));
    const extension = path.extname(resolved).replace(/^\./, "").toLowerCase();
    const { result } = await invokeConvert(
      dependencies.getProviderRegistry(),
      {
        path: resolved,
        kind: assetKindForExtension(extension),
        extension,
        targetFormat: z.string().trim().min(1).max(16).parse(targetFormat),
        options: {},
      },
    );
    return result;
  });
  // 转换任务当前同步完成：job id 仅作幂等确认标记。
  ipc.handle("media:cancel", (jobId) => {
    const parsed = z.string().min(1).max(128).parse(jobId);
    return Boolean(parsed);
  });

  // --- sequences（计划 §9.4 / §13.4）---

  ipc.handle("sequences:detect", async (directory, options) => {
    const resolved = path.resolve(pathSchema.parse(directory));
    const parsed =
      z
        .object({ customPatterns: z.array(z.string()).max(16).optional() })
        .optional()
        .parse(options) ?? {};
    const groups = await detectSequencesInDirectory(resolved, {
      customPatterns: parsed.customPatterns,
    });
    return groups.map((group) => ({
      id: group.id,
      directory: group.directory,
      baseName: group.baseName,
      extension: group.extension,
      pattern: group.pattern,
      files: group.files,
      frames: group.frames,
      start: group.start,
      end: group.end,
      missingFrames: group.missingFrames,
      width: group.width,
      fps: group.fps,
    }));
  });

  // --- providers（计划 §6.1 / §13.4）---

  ipc.handle("providers:list", () =>
    dependencies.getProviderRegistry().list().map((manifest) => ({
      id: manifest.id,
      version: manifest.version,
      kinds: manifest.kinds,
      extensions: manifest.extensions,
      capabilities: manifest.capabilities,
      priority: manifest.priority,
      runtime: manifest.runtime,
    })),
  );
  ipc.handle("providers:health", (providerId) =>
    dependencies
      .getProviderRegistry()
      .health(z.string().trim().min(1).max(128).parse(providerId)),
  );
}

function thumbnailIdForPath(filename: string): string {
  // 稳定可复现的文件名（不含路径信息，防止缓存文件名泄露绝对路径）。
  return createHash("sha256").update(path.normalize(filename)).digest("hex").slice(0, 20);
}

function mimeTypeForPath(filename: string): string {
  const extension = path.extname(filename).replace(/^\./, "").toLowerCase();
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    avif: "image/avif",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    pdf: "application/pdf",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    obj: "model/obj",
    stl: "model/stl",
  };
  return mimeTypes[extension] ?? "application/octet-stream";
}
