import type {
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
  ProviderConvertInput,
  ProviderConvertResult,
  ResourceProvider,
  ResourceProviderManifest,
} from "../../shared/worker-protocol";

/**
 * DCC provider（阶段 4：专业格式 — DCC 场景）。
 *
 * 无本地 DCC runtime，不静默依赖本机 DCC 软件：probe 返回明确
 * 降级说明（验收：不显示虚假支持）。
 * PSD/PSB 由 image-provider 处理（ffmpeg composite）。
 * Alembic（.abc）归 model3d 类（通用 3D 交换格式），不在此 provider。
 */

const DCC_FORMATS: Record<string, string> = {
  blend: "Blender：本地无 Blender runtime，不静默依赖本机软件",
  blend1: "Blender 备份：本地无 Blender runtime，不静默依赖本机软件",
  ma: "Maya：无本地 DCC provider",
  mb: "Maya 二进制：无本地 DCC provider",
  max: "3ds Max：无本地 DCC provider",
  c4d: "Cinema 4D：无本地 DCC provider",
  hip: "Houdini：无本地 DCC provider",
  hipnc: "Houdini 二进制：无本地 DCC provider",
};

export const DCC_PROVIDER_MANIFEST: ResourceProviderManifest = {
  id: "dcc-provider",
  version: "1.0.0",
  kinds: ["dcc"],
  extensions: ["blend", "blend1", "ma", "mb", "max", "c4d", "hip", "hipnc"],
  mimeTypes: [],
  capabilities: ["probe", "metadata"],
  priority: 15,
  runtime: "node",
};

export class DccProvider implements ResourceProvider {
  readonly manifest: ResourceProviderManifest = DCC_PROVIDER_MANIFEST;

  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "DCC 降级说明 provider" };
  }

  async probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
    const extension = input.extension.toLowerCase();
    const reason = DCC_FORMATS[extension];
    if (!reason) {
      throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
    }
    return {
      width: null,
      height: null,
      duration: null,
      extra: {
        format: extension,
        unsupportedReason: reason,
      },
    };
  }

  async metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult> {
    const extension = input.extension.toLowerCase();
    const reason = DCC_FORMATS[extension];
    if (!reason) {
      throw new Error("PROVIDER_CAPABILITY_UNSUPPORTED");
    }
    return {
      fields: {
        format: extension.toUpperCase(),
        note: reason,
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
