import { createHash, randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import sharp from "sharp";
import { z } from "zod";
import path from "node:path";
import type { UserMetadataPatch } from "../../shared/contracts";
import type { MountChangedEvent } from "../../shared/contracts";
import { assetKindForExtension } from "../../shared/asset-kind";
import type { RefCanvasDatabase } from "../persistence/database";
import type { LibraryService } from "../services/library-service";
import type { MountService } from "../services/mount-service";
import type { SecureIpcRegistrar } from "../platform/secure-ipc";
import {
  invokeConvert,
  invokeProbe,
  invokeThumbnail,
  invokeWaveform,
  type ProviderRegistry,
} from "../platform/provider-registry";
import type { ThumbnailWorkerClient } from "../platform/thumbnail-worker-client";
import type { ScriptsService } from "../services/scripts-service";
import type { PreviewTokenRegistry } from "../platform/refbrowse";
import { extractVideoFrame, applyLut3dToPng } from "../services/media/ffmpeg-tools";
import { validateOcioConfigWithOpenImageIo } from "../services/media/openimageio-tools";
import { detectSequencesInDirectory } from "../services/media/sequence-service";
import { readTextPreview } from "../services/media/text-reader";
import { exportSequenceToMp4, exportVideoToMp4 } from "../services/media/mp4-export";
import {
  exportSequenceToGif,
  exportVideoToGif,
  exportVideosToGif,
} from "../services/media/gif-export";
import { exportVideoFrames } from "../services/media/video-frame-export";
import {
  downscaleImage,
  planDownscale,
} from "../services/media/downscale";
import { PREVIEW_SETTINGS_DEFAULTS } from "../../shared/contracts";
import { readPreviewSettings } from "./preview-settings";
import { idSchema, pathSchema } from "./schemas";
import { extractDominantPalette } from "../../shared/color-palette";
import { previewCacheKey } from "../platform/preview-cache-key";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import {
  assertAbsoluteLocalPath,
} from "../platform/local-path-security";
import type { WriteAccessController } from "../platform/write-access-controller";
import type { MediaJobRegistry, MediaJobStartMeta } from "../services/media-job-registry";

interface ResourcesIpcDependencies {
  getDatabase(): RefCanvasDatabase;
  getLibrary(): LibraryService;
  getMountService(): MountService;
  getProviderRegistry(): ProviderRegistry;
  getThumbnailWorker(): ThumbnailWorkerClient | null;
  getThumbnailCacheDirectory(): string;
  getScriptsService(): ScriptsService;
  previewTokens: PreviewTokenRegistry;
  notifyMountsChanged(change: MountChangedEvent): void;
  windowForSender(event: IpcMainInvokeEvent): BrowserWindow;
  writeAccess: WriteAccessController;
  getMediaJobRegistry(): MediaJobRegistry;
}

/**
 * §13.4 新增 API：mounts / metadata / media / providers。
 * 与既有 library/filesystem 命名空间并存，逐步替换旧入口。
 */
export function registerResourcesIpc(
  ipc: SecureIpcRegistrar,
  dependencies: ResourcesIpcDependencies,
): void {
  const database = () => dependencies.getDatabase();
  const library = () => dependencies.getLibrary();
  const mediaJobs = new Map<string, AbortController>();
  async function runMediaJob<T>(
    requestedId: string | undefined,
    task: (signal: AbortSignal, jobId: string) => Promise<T>,
    track?: MediaJobStartMeta,
  ): Promise<T & { jobId: string }> {
    const jobId = requestedId ?? randomUUID();
    if (mediaJobs.has(jobId)) throw new Error("MEDIA_JOB_EXISTS");
    const controller = new AbortController();
    mediaJobs.set(jobId, controller);
    const registry = track ? dependencies.getMediaJobRegistry() : null;
    if (registry && track) {
      registry.start(jobId, track);
      registry.attachController(jobId, controller);
    }
    try {
      const result = await task(controller.signal, jobId);
      registry?.complete(jobId, track?.output ?? null);
      return { ...result, jobId };
    } catch (error) {
      if (registry) {
        const message = error instanceof Error ? error.message : String(error ?? "MEDIA_JOB_FAILED");
        registry.fail(jobId, "MEDIA_JOB_FAILED", message);
      }
      throw error;
    } finally {
      mediaJobs.delete(jobId);
    }
  }

  // --- mounts（计划 §7.2 / §13.4）---

  ipc.handle("mounts:list", () => database().listMountRoots());
  ipc.handle("mounts:add", async (mountPath) => {
    const resolved = assertAbsoluteLocalPath(pathSchema.parse(mountPath));
    const existing = database()
      .listMountRoots()
      .find((item) => item.path === resolved);
    if (existing) return existing;
    // watch root 即挂载根（§7.2）：注册后启动监视，不复制任何文件。
    const watchRoot = await library().addWatchRoot(resolved);
    const mount = database().listMountRoots().find((item) => item.id === watchRoot.id)!;
    dependencies.notifyMountsChanged({
      type: "added",
      mountId: mount.id,
      state: mount.state,
    });
    return mount;
  });
  ipc.handle("mounts:remove", async (mountId) => {
    const parsedId = idSchema.parse(mountId);
    await library().removeWatchRoot(parsedId);
    dependencies.notifyMountsChanged({ type: "removed", mountId: parsedId });
  });
  ipc.handle("mounts:reconnect", async (mountId) => {
    const parsedId = idSchema.parse(mountId);
    await dependencies.getMountService().refreshMount(parsedId);
    const mount = database().listMountRoots().find((item) => item.id === parsedId);
    if (!mount) throw new Error("MOUNT_NOT_FOUND");
    return mount;
  });

  // --- metadata（计划 §7.2 / §13.4）---

  ipc.handle("metadata:ensure", (filename) =>
    library().materializePath(assertAbsoluteLocalPath(pathSchema.parse(filename))),
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

  // --- media（计划 §9 / §13.4）---

  ipc.handle("media:probe", async (filename) => {
    const resolved = assertAbsoluteLocalPath(pathSchema.parse(filename));
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
  // 校验自定义 OCIO 配置：解析色彩空间并跑一次最小转换（LUT 引用缺失的
  // 配置在此暴露），让 OCIO 菜单在应用配置前就能给出明确原因。
  ipc.handle("media:validateOcioConfig", async (filename) => {
    const resolved = assertAbsoluteLocalPath(pathSchema.parse(filename));
    const validation = await validateOcioConfigWithOpenImageIo(resolved);
    return {
      ok: validation.ok,
      detail: validation.ok ? null : (validation.detail ?? "UNKNOWN"),
    };
  });
  ipc.handle("media:thumbnail", async (filename, options) => {
    const resolved = assertAbsoluteLocalPath(pathSchema.parse(filename));
    const extension = path.extname(resolved).replace(/^\./, "").toLowerCase();
    const parsed =
      z
      .object({
        width: z.number().int().min(16).max(8_192).optional(),
        height: z.number().int().min(16).max(8_192).optional(),
        channel: z.string().trim().regex(/^[a-z0-9_.-]{1,256}$/i).optional(),
      })
        .optional()
        .parse(options) ?? {};
    const cacheDirectory = dependencies.getThumbnailCacheDirectory();
    if (!cacheDirectory) throw new Error("THUMBNAIL_CACHE_UNAVAILABLE");
    // 阶段 5 §10.3：当前 LUT 进入 cache key（路径+mtime+size），
    // LUT 变化自动失效；activeLut 存在时缩略图叠加 lut3d。
    const settings = readPreviewSettings(database());
    let lutSignature = "nolut";
    let lutPath: string | null = null;
    if (settings.activeLut) {
      const lutInfo = await stat(settings.activeLut).catch(() => null);
      if (lutInfo?.isFile()) {
        lutPath = settings.activeLut;
        lutSignature = createHash("sha256")
          .update(
            `${path.normalize(settings.activeLut)}:${lutInfo.mtimeMs}:${lutInfo.size}`,
          )
          .digest("hex")
          .slice(0, 10);
      }
    }
    const target = path.join(
      cacheDirectory,
      `media-${thumbnailIdForPath(resolved)}-${lutSignature}-${parsed.channel
        ? createHash("sha256").update(parsed.channel).digest("hex").slice(0, 12)
        : "composite"}.png`,
    );
    const kind = assetKindForExtension(extension);
    // 阶段 3/4：EXR/HDR、视频、PSD/PSB、音频、字体、文本走 provider
    // registry（display transform / poster / composite / 封面或波形/
    // 样张 SVG）；其余图片走 sharp worker（libvips 原生支持 HEIC/AVIF）。
    const registryFormats =
      extension === "exr" ||
      extension === "hdr" ||
      kind === "video" ||
      extension === "psd" ||
      extension === "psb" ||
      kind === "audio" ||
      extension === "ttf" ||
      extension === "otf" ||
      extension === "woff" ||
      extension === "woff2" ||
      extension === "ttc" ||
      extension === "txt" ||
      extension === "md" ||
      extension === "markdown" ||
      extension === "rtf" ||
      extension === "srt" ||
      extension === "vtt" ||
      extension === "json" ||
      extension === "yaml" ||
      extension === "yml" ||
      extension === "xml" ||
      extension === "csv" ||
      extension === "log" ||
      extension === "ini" ||
      extension === "toml" ||
      extension === "conf" ||
      extension === "html" ||
      extension === "htm" ||
      extension === "css" ||
      extension === "js" ||
      extension === "ts" ||
      extension === "py" ||
      extension === "sh" ||
      extension === "bat" ||
      extension === "ps1";
    if (registryFormats) {
      const { result } = await invokeThumbnail(
        dependencies.getProviderRegistry(),
        {
          path: resolved,
          kind,
          extension,
          width: parsed.width ?? 480,
          height: parsed.height ?? 320,
          outputPath: target,
          channel: parsed.channel,
        },
      );
      if (lutPath) {
        await applyLut3dToPng(result.path, lutPath, target);
      }
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
    if (lutPath) {
      await applyLut3dToPng(target, lutPath, target);
    }
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
    const resolved = assertAbsoluteLocalPath(pathSchema.parse(filename));
    const parsed = z
      .object({
        timeMs: z.number().min(0).max(86_400_000).default(0),
        width: z.number().int().min(16).max(8_192).optional(),
        height: z.number().int().min(16).max(8_192).optional(),
        jobId: z.string().min(1).max(128).optional(),
      })
      .parse(options ?? {});
    return runMediaJob(parsed.jobId, async (signal, jobId) => {
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
        }, undefined, signal);
      }
      const token = dependencies.previewTokens.tokenFor(target);
      return {
        source: `refbrowse://preview/${token}`,
        path: target,
        timeMs: parsed.timeMs,
        jobId,
      };
    });
  });
  ipc.handle("media:palette", async (filename, options) => {
    const resolved = assertAbsoluteLocalPath(pathSchema.parse(filename));
    const parsed = z
      .object({
        timeMs: z.number().min(0).max(86_400_000).default(0),
        limit: z.number().int().min(1).max(12).default(6),
      })
      .parse(options ?? {});
    const extension = path.extname(resolved).replace(/^\./, "").toLowerCase();
    const kind = assetKindForExtension(extension);
    let samplePath = resolved;
    let removeSample = false;
    if (extension === "exr" || extension === "hdr") {
      const cacheDirectory = dependencies.getThumbnailCacheDirectory();
      if (!cacheDirectory) throw new Error("THUMBNAIL_CACHE_UNAVAILABLE");
      // 大体积 EXR/HDR 不再为取色做全分辨率解码：优先复用显示层已解码
      // 的 PNG 变体（1920/960/480，命中任一个都行），否则解码一次 320
      // 并持久缓存（键含路径+大小+mtime，文件变化自动失效）。
      const info = await stat(resolved).catch(() => null);
      if (!info) throw new Error("PALETTE_SOURCE_UNAVAILABLE");
      const identity = {
        realPath: resolved,
        size: info.size,
        mtimeMs: info.mtimeMs,
      };
      let sourceWebp: string | null = null;
      const displayVariants = [
        "thumbnail-1920x1920-webp",
        "thumbnail-960x960-webp",
        "thumbnail-480x480-webp",
      ] as const;
      for (const variant of displayVariants) {
        const candidate = path.join(
          cacheDirectory,
          "directory",
          `${previewCacheKey({ ...identity, variant })}.webp`,
        );
        if (await stat(candidate).then(() => true, () => false)) {
          sourceWebp = candidate;
          break;
        }
      }
      if (!sourceWebp) {
        const paletteFile = path.join(
          cacheDirectory,
          `palette-${previewCacheKey({ ...identity, variant: "palette-320-webp" })}.webp`,
        );
        if (await stat(paletteFile).then(() => true, () => false)) {
          sourceWebp = paletteFile;
        } else {
          await invokeThumbnail(dependencies.getProviderRegistry(), {
            path: resolved,
            kind,
            extension,
            width: 320,
            height: 320,
            outputPath: paletteFile,
          });
          sourceWebp = paletteFile;
        }
      }
      samplePath = sourceWebp;
      // removeSample 保持 false：样本持久缓存，二次打开与逐帧刷新直接复用。
    } else if (kind === "video" || extension === "bmp") {
      // BMP 必须走 ffmpeg 抽帧：本构建的 sharp/libvips 不含 BMP 解码器
      // （实测所有 BMP 变体均报 unsupported image format），直接喂 sharp
      // 会抛错。勿改回 sharp 直解。
      const cacheDirectory = dependencies.getThumbnailCacheDirectory();
      if (!cacheDirectory) throw new Error("THUMBNAIL_CACHE_UNAVAILABLE");
      const signature = createHash("sha256")
        .update(`${path.normalize(resolved)}:${kind === "video" ? Math.round(parsed.timeMs) : 0}:${randomUUID()}:palette`)
        .digest("hex")
        .slice(0, 20);
      samplePath = path.join(cacheDirectory, `palette-${signature}.png`);
      removeSample = true;
      await extractVideoFrame(resolved, kind === "video" ? parsed.timeMs : 0, samplePath, {
        width: 320,
        height: 320,
      });
    }
    if (kind !== "image" && kind !== "video") {
      throw new Error("PALETTE_UNSUPPORTED_MEDIA");
    }
    try {
      const { data } = await sharp(samplePath, { animated: false, failOn: "none" })
        .rotate()
        .resize({ width: 128, height: 128, fit: "inside", withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return extractDominantPalette(data, parsed.limit);
    } finally {
      if (removeSample) await rm(samplePath, { force: true }).catch(() => undefined);
    }
  });
  ipc.handle("media:preview", (filename) => {
    const resolved = assertAbsoluteLocalPath(pathSchema.parse(filename));
    const token = dependencies.previewTokens.tokenFor(resolved);
    return {
      source: `refbrowse://preview/${token}`,
      mimeType: mimeTypeForPath(resolved),
    };
  });
  /**
   * 阶段 4：音频波形峰值（provider waveform，8kHz 流式解码）。
   * samples：目标峰值数量（0 使用 provider 默认）。
   */
  ipc.handle("media:waveform", async (filename, options) => {
    const resolved = assertAbsoluteLocalPath(pathSchema.parse(filename));
    const extension = path.extname(resolved).replace(/^\./, "").toLowerCase();
    const parsed =
      z
        .object({ samples: z.number().int().min(0).max(8_192).optional() })
        .optional()
        .parse(options) ?? {};
    const { result } = await invokeWaveform(
      dependencies.getProviderRegistry(),
      {
        path: resolved,
        kind: assetKindForExtension(extension),
        extension,
        samples: parsed.samples ?? 2400,
      },
    );
    return result;
  });
  /**
   * 阶段 4：文本预览读取（前 N 字节，UTF-8 探测，二进制拒绝）。
   */
  ipc.handle("media:readText", async (filename, options) => {
    const resolved = assertAbsoluteLocalPath(pathSchema.parse(filename));
    const parsed =
      z
        .object({
          limit: z.number().int().min(1024).max(2_000_000).optional(),
        })
        .optional()
        .parse(options) ?? {};
    return readTextPreview(resolved, parsed.limit);
  });
  ipc.handle("media:convert", async (filename, targetFormat, requestedJobId) => {
    const resolved = assertAbsoluteLocalPath(pathSchema.parse(filename));
    const extension = path.extname(resolved).replace(/^\./, "").toLowerCase();
    const jobId = z.string().min(1).max(128).optional().parse(requestedJobId);
    return runMediaJob(jobId, async (signal, currentJobId) => {
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
      signal.throwIfAborted();
      return { ...result, jobId: currentJobId };
    }, {
      kind: "convert",
      stage: "converting",
      output: null,
    });
  });
  ipc.handle("media:cancel", (jobId) => {
    const parsed = z.string().min(1).max(128).parse(jobId);
    const registry = dependencies.getMediaJobRegistry();
    const controller = mediaJobs.get(parsed);
    if (controller) controller.abort(new Error("MEDIA_JOB_CANCELLED"));
    return registry ? registry.cancel(parsed) : Boolean(controller);
  });
  ipc.handleWithEvent("media:exportGif", async (event, request) => {
    const parsed = z.object({
      inputPath: pathSchema.optional(),
      clips: z.array(z.object({
        inputPath: pathSchema,
        startMs: z.number().min(0).max(86_400_000).optional(),
        endMs: z.number().min(0).max(86_400_000).optional(),
      })).min(1).max(50).optional(),
      outputDirectory: pathSchema,
      baseName: z.string().min(1).max(128),
      fps: z.number().int().min(1).max(60).optional(),
      maxWidth: z.number().int().min(64).max(3840).optional(),
      colors: z.number().int().min(16).max(256).optional(),
      dither: z.enum(["none", "bayer", "floyd_steinberg", "sierra2_4a"]).optional(),
      jobId: z.string().min(1).max(128).optional(),
    }).refine((value) => Boolean(value.inputPath || value.clips?.length), {
      message: "GIF_EXPORT_EMPTY",
    }).parse(request);
    const outputDirectory = assertAbsoluteLocalPath(parsed.outputDirectory);
    const inputPath = parsed.inputPath ? assertAbsoluteLocalPath(parsed.inputPath) : undefined;
    const clips = parsed.clips?.map((clip) => ({
      ...clip,
      inputPath: assertAbsoluteLocalPath(clip.inputPath),
    }));
    const safeBase = parsed.baseName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
    const candidate = await availableOutputPath(outputDirectory, safeBase, "gif");
    const [outputPath] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event), "export", [{ path: candidate, mode: "destination" }],
    );
    return runMediaJob(parsed.jobId, async (signal, jobId) => {
      const common = {
        fps: parsed.fps ?? 12,
        maxWidth: parsed.maxWidth ?? 960,
        colors: parsed.colors ?? 256,
        dither: parsed.dither ?? "sierra2_4a" as const,
        outputPath,
      };
      const result = clips
        ? await exportVideosToGif({ ...common, clips }, signal)
        : await exportVideoToGif({
            ...common,
            inputPath: inputPath!,
          }, signal);
      return { ...result, outputPath, frameCount: null, jobId };
    }, {
      kind: "export",
      stage: "exporting",
      output: outputPath,
    });
  });
  ipc.handleWithEvent("media:exportFrames", async (event, request) => {
    const parsed = z.object({
      inputPath: pathSchema,
      outputDirectory: pathSchema,
      baseName: z.string().min(1).max(128),
      format: z.enum(["png", "jpeg"]),
      fps: z.number().min(0.01).max(240).nullable().optional(),
      startMs: z.number().min(0).max(86_400_000).optional(),
      endMs: z.number().min(0).max(86_400_000).optional(),
      quality: z.number().int().min(1).max(100).optional(),
      jobId: z.string().min(1).max(128).optional(),
    }).parse(request);
    const inputPath = assertAbsoluteLocalPath(parsed.inputPath);
    const [outputDirectory] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event), "export", [
        { path: assertAbsoluteLocalPath(parsed.outputDirectory), mode: "destination" },
      ],
    );
    return runMediaJob(parsed.jobId, async (signal, jobId) => ({
      ...(await exportVideoFrames({
        ...parsed,
        inputPath,
        outputDirectory,
      }, signal)),
      jobId,
    }), {
      kind: "export",
      stage: "exporting frames",
      output: outputDirectory,
    });
  });
  ipc.handleWithEvent("media:exportMp4", async (event, request) => {
    const parsed = z.object({
      inputPath: pathSchema,
      outputDirectory: pathSchema,
      baseName: z.string().min(1).max(128),
      presetId: z.string().min(1).max(64),
      jobId: z.string().min(1).max(128).optional(),
    }).parse(request);
    const inputPath = assertAbsoluteLocalPath(parsed.inputPath);
    const outputDirectory = assertAbsoluteLocalPath(parsed.outputDirectory);
    const safeBase = parsed.baseName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
    const candidate = await availableOutputPath(outputDirectory, safeBase, "mp4");
    const [outputPath] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event), "export", [{ path: candidate, mode: "destination" }],
    );
    return runMediaJob(parsed.jobId, async (signal, jobId) => {
      const settings = readPreviewSettings(database());
      const preset =
        settings.mp4Presets.find(
          (item) => item.id === parsed.presetId && item.enabled,
        ) ??
        settings.mp4Presets.find((item) => item.enabled) ??
        settings.mp4Presets[0];
      const result = await exportVideoToMp4({
        inputPath,
        codec: preset.codec,
        quality: preset.quality,
        resolution: preset.resolution,
        outputPath,
      }, signal);
      return {
        outputPath,
        durationSeconds: result.durationSeconds,
        width: result.width,
        height: result.height,
        jobId,
      };
    }, {
      kind: "export",
      stage: "exporting",
      output: outputPath,
    });
  });
  ipc.handleWithEvent("media:exportDisplayChannel", async (event, request) => {
    const parsed = z.object({
      inputPath: pathSchema,
      outputDirectory: pathSchema,
      baseName: z.string().min(1).max(128),
      channel: z.string().trim().regex(/^[a-z0-9_.-]{1,256}$/i).optional(),
      jobId: z.string().min(1).max(128).optional(),
    }).parse(request);
    const inputPath = assertAbsoluteLocalPath(parsed.inputPath);
    const outputDirectory = assertAbsoluteLocalPath(parsed.outputDirectory);
    const safeBase = parsed.baseName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
    const safeChannel = parsed.channel?.replace(/[^a-z0-9_.-]/gi, "_") ?? "composite";
    const candidate = await availableOutputPath(
      outputDirectory, `${safeBase}-${safeChannel}`, "png",
    );
    const [authorizedOutputPath] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event), "export", [
        { path: candidate, mode: "destination" },
      ],
    );
    return runMediaJob(parsed.jobId, async (signal, jobId) => {
      const extension = path.extname(inputPath).replace(/^\./, "").toLowerCase();
      if (extension !== "exr" && extension !== "hdr") {
        throw new Error("DISPLAY_CHANNEL_FORMAT_UNSUPPORTED");
      }
      const kind = assetKindForExtension(extension);
      const { result: probe } = await invokeProbe(
        dependencies.getProviderRegistry(),
        { path: inputPath, kind, extension, size: 0 },
      );
      signal.throwIfAborted();
      const { result } = await invokeThumbnail(
        dependencies.getProviderRegistry(),
        {
          path: inputPath,
          kind,
          extension,
          width: Math.max(16, probe.width ?? 1920),
          height: Math.max(16, probe.height ?? 1080),
          outputPath: authorizedOutputPath,
          channel: parsed.channel,
        },
      );
      signal.throwIfAborted();
      return {
        outputPath: result.path,
        width: result.width,
        height: result.height,
        channel: parsed.channel ?? null,
        jobId,
      };
    }, {
      kind: "export",
      stage: "exporting display channel",
      output: authorizedOutputPath,
    });
  });

  // --- sequences（计划 §9.4 / §13.4）---

  ipc.handle("sequences:detect", async (directory, options) => {
    const resolved = assertAbsoluteLocalPath(pathSchema.parse(directory));
    const parsed =
      z
        .object({ customPatterns: z.array(z.string()).max(16).optional() })
        .optional()
        .parse(options) ?? {};
    // 阶段 5：序列规则（sequenceRules pattern + sequenceMinFrames 过滤）
    // 进入检测任务参数；调用方显式传 customPatterns 时优先。
    const settings = readPreviewSettings(database());
    const customPatterns =
      parsed.customPatterns ?? settings.sequenceRules.map((rule) => rule.pattern);
    const groups = await detectSequencesInDirectory(resolved, {
      customPatterns,
    });
    const minFrames = Math.max(
      1,
      settings.sequenceMinFrames || PREVIEW_SETTINGS_DEFAULTS.sequenceMinFrames,
    );
    return groups
      .filter((group) => group.files.length >= minFrames)
      .map((group) => ({
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

  // --- sequences:exportMp4（阶段 5 §10.1 MP4 presets）---

  ipc.handleWithEvent("sequences:exportMp4", async (event, request) => {
    const parsed = z
      .object({
        files: z.array(pathSchema).min(1).max(100_000),
        fps: z.number().int().min(1).max(240),
        presetId: z.string().min(1).max(64),
        outputDirectory: pathSchema,
        baseName: z.string().min(1).max(128),
        jobId: z.string().min(1).max(128).optional(),
      })
      .parse(request);
    const files = parsed.files.map(assertAbsoluteLocalPath);
    const outputDirectory = assertAbsoluteLocalPath(parsed.outputDirectory);
    const safeBase = parsed.baseName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
    const candidate = await availableOutputPath(outputDirectory, safeBase, "mp4");
    const [outputPath] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event), "export", [{ path: candidate, mode: "destination" }],
    );
    return runMediaJob(parsed.jobId, async (signal, jobId) => {
      const settings = readPreviewSettings(database());
      const preset =
        settings.mp4Presets.find(
          (item) => item.id === parsed.presetId && item.enabled,
        ) ??
        settings.mp4Presets.find((item) => item.enabled) ??
        settings.mp4Presets[0];
      const result = await exportSequenceToMp4({
        files,
        fps: parsed.fps,
        codec: preset.codec,
        quality: preset.quality,
        resolution: preset.resolution,
        outputPath,
      }, signal);
      return {
        outputPath,
        durationSeconds: result.durationSeconds,
        frameCount: parsed.files.length,
        width: result.width,
        height: result.height,
        jobId,
      };
    }, {
      kind: "export",
      stage: "exporting",
      output: outputPath,
    });
  });

  ipc.handleWithEvent("sequences:exportGif", async (event, request) => {
    const parsed = z.object({
      files: z.array(pathSchema).min(1).max(100_000),
      fps: z.number().int().min(1).max(60),
      outputDirectory: pathSchema,
      baseName: z.string().min(1).max(128),
      maxWidth: z.number().int().min(64).max(3840).optional(),
      colors: z.number().int().min(16).max(256).optional(),
      dither: z.enum(["none", "bayer", "floyd_steinberg", "sierra2_4a"]).optional(),
      jobId: z.string().min(1).max(128).optional(),
    }).parse(request);
    const files = parsed.files.map(assertAbsoluteLocalPath);
    const outputDirectory = assertAbsoluteLocalPath(parsed.outputDirectory);
    const safeBase = parsed.baseName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
    const candidate = await availableOutputPath(outputDirectory, safeBase, "gif");
    const [outputPath] = await dependencies.writeAccess.authorize(
      dependencies.windowForSender(event), "export", [{ path: candidate, mode: "destination" }],
    );
    return runMediaJob(parsed.jobId, async (signal, jobId) => {
      const result = await exportSequenceToGif({
        files,
        fps: parsed.fps,
        maxWidth: parsed.maxWidth ?? 960,
        colors: parsed.colors ?? 256,
        dither: parsed.dither ?? "sierra2_4a",
        outputPath,
      }, signal);
      return {
        ...result,
        outputPath,
        frameCount: parsed.files.length,
        jobId,
      };
    }, {
      kind: "export",
      stage: "exporting",
      output: outputPath,
    });
  });

  // Arbitrary child processes cannot be constrained by drive grants. Keep the
  // IPC surface for compatibility, but fail closed until a brokered sandbox is
  // available.
  const scriptExecutionDisabled = (): never => {
    throw new Error("SCRIPT_EXECUTION_DISABLED_UNSANDBOXED");
  };

  ipc.handle("scripts:list", () => dependencies.getScriptsService().list());
  ipc.handle("scripts:register", scriptExecutionDisabled);

  ipc.handle("scripts:unregister", (id) => {
    dependencies.getScriptsService().unregister(z.string().min(1).max(64).parse(id));
  });

  ipc.handle("scripts:run", scriptExecutionDisabled);

  // --- color:get-status（阶段 5 §10.3 色彩管理）---

  ipc.handle("color:get-status", async () => {
    const settings = readPreviewSettings(database());
    const detected = process.env.OCIO ?? null;
    let activeLutExists = false;
    if (settings.activeLut) {
      try {
        const info = await stat(settings.activeLut);
        activeLutExists = info.isFile();
      } catch {
        activeLutExists = false;
      }
    }
    return {
      detectedOcio: detected,
      ocioConfigPath: settings.ocioConfigPath,
      activeLut: settings.activeLut,
      activeLutExists,
      lutDirectories: settings.lutDirectories,
    };
  });

  // --- media:downscale（阶段 5 §10.4 Downscale naming）---

  ipc.handleWithEvent("media:downscale", async (event, request) => {
    const parsed = z
      .object({
        paths: z.array(pathSchema).min(1).max(500),
        maxDimension: z.number().int().min(64).max(16_384),
        mode: z.enum(["suffix", "subdirectory", "backup"]),
        jobId: z.string().min(1).max(128).optional(),
      })
      .parse(request);
    const sourcePaths = parsed.paths.map(assertAbsoluteLocalPath);
    const settings = readPreviewSettings(database());
    const planned = sourcePaths.map((sourcePath) =>
        planDownscale(sourcePath, {
          maxDimension: parsed.maxDimension,
          mode: parsed.mode,
          suffix: settings.downscaleSuffix,
          subdirectory: settings.downscaleSubdirectory,
        }),
      );
    const requests = planned.flatMap((item) => [
      ...(parsed.mode === "backup" ? [{ path: item.sourcePath, mode: "existing" as const }] : []),
      { path: item.outputPath, mode: "destination" as const },
      ...(item.backupPath ? [{ path: item.backupPath, mode: "destination" as const }] : []),
    ]);
    const window = dependencies.windowForSender(event);
    const authorized = await dependencies.writeAccess.authorize(
      window, parsed.mode === "backup" ? "move" : "export", requests,
    );
    let cursor = 0;
    let items = planned.map((item) => ({
      sourcePath: parsed.mode === "backup" ? authorized[cursor++] : item.sourcePath,
      outputPath: authorized[cursor++],
      backupPath: item.backupPath ? authorized[cursor++] : null,
    }));
    if (parsed.mode === "backup") {
      const final = await dependencies.writeAccess.authorize(
        window,
        "move",
        items.flatMap((item) => [
          { path: item.sourcePath, mode: "existing" as const },
          { path: item.outputPath, mode: "destination" as const },
          { path: item.backupPath!, mode: "destination" as const },
        ]),
      );
      cursor = 0;
      items = items.map(() => ({
        sourcePath: final[cursor++],
        outputPath: final[cursor++],
        backupPath: final[cursor++],
      }));
    }
    return runMediaJob(parsed.jobId, async (signal, jobId) => {
      const results: Array<{
        sourcePath: string;
        outputPath: string;
        width: number;
        height: number;
      }> = [];
      for (const item of items) {
        signal.throwIfAborted();
        results.push(await downscaleImage(item, parsed.maxDimension, signal));
      }
      return {
        results,
        modifiesSources: parsed.mode === "backup",
        jobId,
      };
    }, {
      kind: "export",
      stage: "downscaling",
      output: null,
    });
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

async function availableOutputPath(
  directory: string,
  baseName: string,
  extension: string,
): Promise<string> {
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = path.join(
      directory,
      `${baseName}${suffix === 0 ? "" : `-${suffix + 1}`}.${extension}`,
    );
    if (!(await stat(candidate).catch(() => null))) return candidate;
  }
  throw new Error("EXPORT_OUTPUT_UNAVAILABLE");
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
