import type {
  ProviderConvertInput,
  ProviderConvertResult,
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
import type { WorkerOperation } from "../../shared/worker-protocol";
import { WorkerSupervisor } from "./worker-supervisor";

export class WorkerBackedProvider implements ResourceProvider {
  constructor(
    readonly manifest: ResourceProviderManifest,
    private readonly supervisor: WorkerSupervisor,
  ) {}

  health() {
    return Promise.resolve({ ok: true, detail: "isolated provider worker" });
  }

  private submit<T>(
    operation: WorkerOperation,
    input:
      | ProviderProbeInput
      | ProviderMetadataInput
      | ProviderThumbnailInput
      | ProviderWaveformInput
      | ProviderPreviewInput
      | ProviderConvertInput,
  ): Promise<T> {
    return this.supervisor
      .submit({
        providerId: this.manifest.id,
        operation,
        inputPath: input.path,
        options: { ...input },
        cacheKey: `${this.manifest.id}:${operation}:${input.path}:${JSON.stringify(input)}`,
      })
      .then((result) => result.data as T);
  }

  probe(input: ProviderProbeInput): Promise<ProviderProbeResult> {
    return this.submit("probe", input);
  }

  metadata(input: ProviderMetadataInput): Promise<ProviderMetadataResult> {
    return this.submit("metadata", input);
  }

  thumbnail(input: ProviderThumbnailInput): Promise<ProviderThumbnailResult> {
    return this.submit("thumbnail", input);
  }

  waveform(input: ProviderWaveformInput): Promise<ProviderWaveformResult> {
    return this.submit("waveform", input);
  }

  preview(input: ProviderPreviewInput): Promise<ProviderPreviewResult> {
    return this.submit("preview", input);
  }

  convert(input: ProviderConvertInput): Promise<ProviderConvertResult> {
    return this.submit("convert", input);
  }

  async dispose(): Promise<void> {}
}
