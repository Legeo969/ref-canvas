import type { AssetKind } from "../../shared/contracts";
import type {
  ProviderCapability,
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
  ResourceProviderInstance,
  ResourceProviderManifest,
} from "../../shared/worker-protocol";

export interface ProviderCandidate {
  provider: ResourceProvider;
  capability: ProviderCapability;
}

export interface ProviderSelection {
  /** 执行给定 capability 的候选列表（按 priority 降序）。 */
  candidates: ProviderCandidate[];
  /** 最终选中的 provider（主 provider）。 */
  selected: ResourceProvider | null;
}

export interface ProviderInvocationResult {
  providerId: string;
  providerVersion: string;
  /** 实际执行的 capability。 */
  capability: ProviderCapability;
  /** 主 provider 失败后是否降级到 fallback。 */
  fellBack: boolean;
  /** 记录最终 provider、版本、耗时和错误码（计划 §6.3）。 */
  durationMs: number;
  errorCode: string | null;
}

function extensionMatches(manifest: ResourceProviderManifest, extension: string): boolean {
  // 空扩展列表 = 通配 fallback（§6.3 第 1 条：generic 兜底所有格式）。
  if (manifest.extensions.length === 0) return true;
  return manifest.extensions.includes(extension.toLowerCase());
}

function kindMatches(manifest: ResourceProviderManifest, kind: AssetKind): boolean {
  return manifest.kinds.includes(kind);
}

function supports(manifest: ResourceProviderManifest, capability: ProviderCapability): boolean {
  return manifest.capabilities.includes(capability);
}

/**
 * Typed provider registry（计划 §6.1 / §6.3）。
 *
 * Main 的 registry 管理插件与内置 provider；Renderer 不加载任意第三方 DLL。
 * 选择顺序：
 *   1. 根据 extension、MIME 和 magic bytes 生成候选列表。
 *   2. 过滤缺少 runtime 或 health check 失败的 provider。
 *   3. 按 capability、priority 和 fidelity 选择。
 *   4. 主 provider 失败时转入已声明的 fallback。
 *   5. 记录最终 provider、版本、耗时和错误码。
 *   6. 所有 provider 都失败时由调用方显示明确占位和"使用系统打开"。
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, ResourceProviderInstance>();

  register(instance: ResourceProviderInstance): void {
    if (this.providers.has(instance.provider.manifest.id)) {
      throw new Error("PROVIDER_ALREADY_REGISTERED");
    }
    this.providers.set(instance.provider.manifest.id, instance);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  list(): ResourceProviderManifest[] {
    return [...this.providers.values()].map((instance) => instance.provider.manifest);
  }

  get(providerId: string): ResourceProvider | null {
    return this.providers.get(providerId)?.provider ?? null;
  }

  health(providerId: string): Promise<ProviderHealth> {
    const provider = this.get(providerId);
    if (!provider) return Promise.resolve({ ok: false, detail: "PROVIDER_NOT_FOUND" });
    return provider.health();
  }

  /** 生成给定 capability 的候选列表（extension/kind 过滤 + priority 降序）。 */
  candidates(
    kind: AssetKind,
    extension: string,
    capability: ProviderCapability,
  ): ProviderCandidate[] {
    const matches: ProviderCandidate[] = [];
    for (const instance of this.providers.values()) {
      const manifest = instance.provider.manifest;
      if (!kindMatches(manifest, kind)) continue;
      if (!extensionMatches(manifest, extension)) continue;
      if (!supports(manifest, capability)) continue;
      matches.push({ provider: instance.provider, capability });
    }
    matches.sort((left, right) => right.provider.manifest.priority - left.provider.manifest.priority);
    return matches;
  }

  /**
   * 选择一个 provider 执行 capability。
   *
   * 健康检查失败（health() 返回 ok=false 或抛错）的候选被过滤。返回
   * candidates（仅健康候选，按 priority 降序）与 selected（第一个健康
   * 候选，即主 provider）；调用方按 §6.3 在 selected 失败时用 candidates
   * 中的下一个做 fallback。
   */
  async select(
    kind: AssetKind,
    extension: string,
    capability: ProviderCapability,
  ): Promise<ProviderSelection> {
    const all = this.candidates(kind, extension, capability);
    const healthy: ProviderCandidate[] = [];
    for (const candidate of all) {
      try {
        const health = await candidate.provider.health();
        if (!health.ok) continue;
        healthy.push(candidate);
      } catch {
        continue;
      }
    }
    return {
      candidates: healthy,
      selected: healthy[0]?.provider ?? null,
    };
  }

  /** 执行调用并记录 provider、版本、耗时与错误码（§6.3 第 5 条）。 */
  async invoke(
    kind: AssetKind,
    extension: string,
    capability: ProviderCapability,
    fn: (provider: ResourceProvider) => Promise<unknown>,
  ): Promise<{ value: unknown; meta: ProviderInvocationResult }> {
    const selection = await this.select(kind, extension, capability);
    if (!selection.selected) {
      throw new Error(`PROVIDER_NOT_FOUND:${capability}`);
    }
    const started = Date.now();
    let lastError: Error | null = null;
    for (const candidate of selection.candidates) {
      try {
        const value = await fn(candidate.provider);
        return {
          value,
          meta: {
            providerId: candidate.provider.manifest.id,
            providerVersion: candidate.provider.manifest.version,
            capability,
            fellBack: candidate.provider !== selection.selected,
            durationMs: Date.now() - started,
            errorCode: null,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("PROVIDER_FAILED");
        // 继续 fallback 到下一个候选。
      }
    }
    throw lastError ?? new Error("PROVIDER_FAILED");
  }

  async dispose(): Promise<void> {
    for (const instance of this.providers.values()) {
      await instance.dispose().catch(() => undefined);
    }
    this.providers.clear();
  }
}

// --- 便捷 dispatch：把类型化调用映射到 provider 方法 ---

export async function invokeProbe(
  registry: ProviderRegistry,
  input: ProviderProbeInput,
): Promise<{ result: ProviderProbeResult; meta: ProviderInvocationResult }> {
  const { value, meta } = await registry.invoke(
    input.kind,
    input.extension,
    "probe",
    (provider) => provider.probe(input),
  );
  return { result: value as ProviderProbeResult, meta };
}

export async function invokeMetadata(
  registry: ProviderRegistry,
  input: ProviderMetadataInput,
): Promise<{ result: ProviderMetadataResult; meta: ProviderInvocationResult }> {
  const { value, meta } = await registry.invoke(
    input.kind,
    input.extension,
    "metadata",
    (provider) => provider.metadata(input),
  );
  return { result: value as ProviderMetadataResult, meta };
}

export async function invokeThumbnail(
  registry: ProviderRegistry,
  input: ProviderThumbnailInput,
): Promise<{ result: ProviderThumbnailResult; meta: ProviderInvocationResult }> {
  const { value, meta } = await registry.invoke(
    input.kind,
    input.extension,
    "thumbnail",
    (provider) => provider.thumbnail(input),
  );
  return { result: value as ProviderThumbnailResult, meta };
}

export async function invokeWaveform(
  registry: ProviderRegistry,
  input: ProviderWaveformInput,
): Promise<{ result: ProviderWaveformResult; meta: ProviderInvocationResult }> {
  const { value, meta } = await registry.invoke(
    input.kind,
    input.extension,
    "waveform",
    (provider) => provider.waveform(input),
  );
  return { result: value as ProviderWaveformResult, meta };
}

export async function invokePreview(
  registry: ProviderRegistry,
  input: ProviderPreviewInput,
): Promise<{ result: ProviderPreviewResult; meta: ProviderInvocationResult }> {
  const { value, meta } = await registry.invoke(
    input.kind,
    input.extension,
    "preview",
    (provider) => provider.preview(input),
  );
  return { result: value as ProviderPreviewResult, meta };
}

export async function invokeConvert(
  registry: ProviderRegistry,
  input: ProviderConvertInput,
): Promise<{ result: ProviderConvertResult; meta: ProviderInvocationResult }> {
  const { value, meta } = await registry.invoke(
    input.kind,
    input.extension,
    "convert",
    (provider) => provider.convert(input),
  );
  return { result: value as ProviderConvertResult, meta };
}
