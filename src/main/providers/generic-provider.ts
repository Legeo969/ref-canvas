import { stat } from "node:fs/promises";
import type {
  ProviderConvertInput,
  ProviderConvertResult,
  ProviderHealth,
  ProviderMetadataInput,
  ProviderMetadataResult,
  ProviderPreviewInput,
  ProviderPreviewResult,
  ProviderProbeInput,
  ProviderProbeResult,
  ProviderThumbnailInput,
  ProviderThumbnailResult,
  ProviderWaveformInput,
  ProviderWaveformResult,
  ResourceProvider,
  ResourceProviderManifest,
} from "../../shared/worker-protocol";

/**
 * 通用 provider（计划 §6.2 generic-provider）：
 * 纯 Node 实现，提供基础文件信息（probe/metadata）。不做 thumbnail /
 * preview / convert —— 不支持的能力在 manifest 中缺省，不伪装支持。
 */
export const GENERIC_PROVIDER_MANIFEST: ResourceProviderManifest = {
  id: "generic-provider",
  version: "1.0.0",
  kinds: ["image", "video", "audio", "pdf", "model3d", "dcc", "font", "generic"],
  extensions: [],
  mimeTypes: [],
  capabilities: ["probe", "metadata"],
  priority: 0,
  runtime: "node",
};

export class GenericProvider implements ResourceProvider {
  readonly manifest: ResourceProviderManifest = GENERIC_PROVIDER_MANIFEST;

  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "node runtime available" };
  }

  async probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
    const info = await stat(input.path);
    return {
      width: null,
      height: null,
      duration: null,
      extra: { size: info.size, mtimeMs: info.mtimeMs },
    };
  }

  async metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult> {
    const info = await stat(input.path);
    return {
      fields: {
        size: info.size,
        mtimeMs: info.mtimeMs,
        extension: input.extension,
      },
    };
  }

  thumbnail(_input: ProviderThumbnailInput): Promise<ProviderThumbnailResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  waveform(_input: ProviderWaveformInput): Promise<ProviderWaveformResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  preview(_input: ProviderPreviewInput): Promise<ProviderPreviewResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  convert(_input: ProviderConvertInput): Promise<ProviderConvertResult> {
    throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
  }

  async dispose(): Promise<void> {
    // 无自有资源。
  }
}
