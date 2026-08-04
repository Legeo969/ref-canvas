import { describe, expect, it, vi } from "vitest";
import {
  ProviderRegistry,
  invokeProbe,
  invokeThumbnail,
  invokeWaveform,
} from "../../../src/main/platform/provider-registry";
import type {
  ProviderProbeResult,
  ProviderThumbnailResult,
  ResourceProvider,
} from "../../../src/shared/worker-protocol";

function makeProvider(
  manifest: ResourceProvider["manifest"],
  overrides: Partial<ResourceProvider> = {},
): ResourceProvider {
  return {
    manifest,
    health: async () => ({ ok: true, detail: "ok" }),
    probe: async () => ({ width: null, height: null, duration: null, extra: {} }),
    metadata: async () => ({ fields: {} }),
    thumbnail: async () => ({ path: "", width: 0, height: 0 }),
    waveform: async () => ({ peaks: [], secondsPerPoint: 0, duration: 0, durationSeconds: null }),
    preview: async () => ({ source: "", mimeType: "" }),
    convert: async () => ({ path: "", format: "" }),
    dispose: async () => undefined,
    ...overrides,
  };
}

describe("ProviderRegistry", () => {
  it("registers and lists provider manifests", () => {
    const registry = new ProviderRegistry();
    const provider = makeProvider({
      id: "image-provider",
      version: "1.0.0",
      kinds: ["image"],
      extensions: ["png", "jpg"],
      mimeTypes: ["image/png"],
      capabilities: ["probe", "thumbnail"],
      priority: 10,
      runtime: "node",
    });
    registry.register({ provider, dispose: provider.dispose });
    expect(registry.list()).toEqual([provider.manifest]);
    registry.dispose();
  });

  it("builds candidates by extension/kind/capability and sorts by priority", () => {
    const registry = new ProviderRegistry();
    const low = makeProvider({
      id: "fallback",
      version: "1",
      kinds: ["image"],
      extensions: ["png"],
      mimeTypes: [],
      capabilities: ["thumbnail"],
      priority: 5,
      runtime: "node",
    });
    const high = makeProvider({
      id: "primary",
      version: "1",
      kinds: ["image"],
      extensions: ["png"],
      mimeTypes: [],
      capabilities: ["thumbnail"],
      priority: 100,
      runtime: "node",
    });
    registry.register({ provider: low, dispose: low.dispose });
    registry.register({ provider: high, dispose: high.dispose });

    const candidates = registry.candidates("image", "png", "thumbnail");
    expect(candidates.map((c) => c.provider.manifest.id)).toEqual([
      "primary",
      "fallback",
    ]);
    // 不匹配 extension 或 capability 的被过滤。
    expect(registry.candidates("video", "png", "thumbnail")).toHaveLength(0);
    expect(registry.candidates("image", "jpg", "thumbnail")).toHaveLength(0);
    registry.dispose();
  });

  it("selects the highest-priority healthy provider and skips unhealthy ones", async () => {
    const registry = new ProviderRegistry();
    const unhealthy = makeProvider({
      id: "broken",
      version: "1",
      kinds: ["image"],
      extensions: ["png"],
      mimeTypes: [],
      capabilities: ["probe"],
      priority: 100,
      runtime: "node",
    }, {
      health: async () => ({ ok: false, detail: "missing runtime" }),
    });
    const healthy = makeProvider({
      id: "good",
      version: "1",
      kinds: ["image"],
      extensions: ["png"],
      mimeTypes: [],
      capabilities: ["probe"],
      priority: 10,
      runtime: "node",
    });
    registry.register({ provider: unhealthy, dispose: unhealthy.dispose });
    registry.register({ provider: healthy, dispose: healthy.dispose });

    const selection = await registry.select("image", "png", "probe");
    expect(selection.selected?.manifest.id).toBe("good");
    registry.dispose();
  });

  it("falls back to the next candidate when the primary provider fails", async () => {
    const registry = new ProviderRegistry();
    const failing = makeProvider({
      id: "primary",
      version: "1",
      kinds: ["image"],
      extensions: ["png"],
      mimeTypes: [],
      capabilities: ["probe"],
      priority: 100,
      runtime: "node",
    }, {
      probe: async () => {
        throw new Error("CODEC_MISSING");
      },
    });
    const fallback = makeProvider({
      id: "fallback",
      version: "1",
      kinds: ["image"],
      extensions: ["png"],
      mimeTypes: [],
      capabilities: ["probe"],
      priority: 10,
      runtime: "node",
    }, {
      probe: async () => ({ width: 4, height: 4, duration: null, extra: {} } satisfies ProviderProbeResult),
    });
    registry.register({ provider: failing, dispose: failing.dispose });
    registry.register({ provider: fallback, dispose: fallback.dispose });

    const { result, meta } = await invokeProbe(registry, {
      path: "C:\\f.png",
      kind: "image",
      extension: "png",
      size: 10,
    });
    expect(result.width).toBe(4);
    expect(meta.providerId).toBe("fallback");
    expect(meta.fellBack).toBe(true);
    expect(meta.errorCode).toBeNull();
    registry.dispose();
  });

  it("reports provider id and version on a successful invocation", async () => {
    const registry = new ProviderRegistry();
    const provider = makeProvider({
      id: "image-provider",
      version: "3.2.1",
      kinds: ["image"],
      extensions: ["png"],
      mimeTypes: [],
      capabilities: ["thumbnail"],
      priority: 10,
      runtime: "node",
    }, {
      thumbnail: async () => ({ path: "C:\\cache\\t.png", width: 32, height: 32 } satisfies ProviderThumbnailResult),
    });
    registry.register({ provider, dispose: provider.dispose });

    const { result, meta } = await invokeThumbnail(registry, {
      path: "C:\\f.png",
      kind: "image",
      extension: "png",
      width: 32,
      height: 32,
    });
    expect(result.path).toContain("t.png");
    expect(meta.providerId).toBe("image-provider");
    expect(meta.providerVersion).toBe("3.2.1");
    registry.dispose();
  });

  it("throws when no provider supports the request", async () => {
    const registry = new ProviderRegistry();
    const provider = makeProvider({
      id: "image-provider",
      version: "1",
      kinds: ["image"],
      extensions: ["png"],
      mimeTypes: [],
      capabilities: ["thumbnail"],
      priority: 10,
      runtime: "node",
    });
    registry.register({ provider, dispose: provider.dispose });
    await expect(
      invokeProbe(registry, {
        path: "C:\\f.png",
        kind: "image",
        extension: "png",
        size: 1,
      }),
    ).rejects.toThrow("PROVIDER_NOT_FOUND");
    registry.dispose();
  });

  it("dispatches a waveform capability through the typed helper", async () => {
    const registry = new ProviderRegistry();
    const provider = makeProvider({
      id: "audio-provider",
      version: "1",
      kinds: ["audio"],
      extensions: ["wav"],
      mimeTypes: [],
      capabilities: ["waveform"],
      priority: 10,
      runtime: "node",
    }, {
      waveform: async () => ({ peaks: [0.1, 0.5, 0.9], secondsPerPoint: 1, duration: 3, durationSeconds: 3 } as const),
    });
    registry.register({ provider, dispose: provider.dispose });

    const { result, meta } = await invokeWaveform(registry, {
      path: "C:\\clip.wav",
      kind: "audio",
      extension: "wav",
      samples: 3,
    });
    expect(result.peaks).toHaveLength(3);
    expect(meta.providerId).toBe("audio-provider");
    registry.dispose();
  });

  it("disposes all registered providers", async () => {
    const registry = new ProviderRegistry();
    const dispose = vi.fn(async () => undefined);
    const provider = makeProvider({
      id: "p",
      version: "1",
      kinds: ["image"],
      extensions: ["png"],
      mimeTypes: [],
      capabilities: ["probe"],
      priority: 1,
      runtime: "node",
    }, { dispose });
    registry.register({ provider, dispose });
    await registry.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("selects a generic wildcard provider as the final fallback for any extension", async () => {
    const registry = new ProviderRegistry();
    const generic = makeProvider({
      id: "generic-provider",
      version: "1",
      kinds: ["image", "video", "generic"],
      extensions: [],
      mimeTypes: [],
      capabilities: ["probe"],
      priority: 0,
      runtime: "node",
    }, {
      probe: async () => ({ width: null, height: null, duration: null, extra: {} } satisfies ProviderProbeResult),
    });
    registry.register({ provider: generic, dispose: generic.dispose });

    // 任意扩展名都能选中 generic fallback（空扩展列表 = 通配）。
    for (const extension of ["png", "mp4", "unknown"]) {
      const selection = await registry.select("image", extension, "probe");
      expect(selection.selected?.manifest.id).toBe("generic-provider");
    }
    registry.dispose();
  });

  it("never invokes an unhealthy candidate during fallback", async () => {
    const registry = new ProviderRegistry();
    const probe = vi.fn(async () => ({ width: 1, height: 1, duration: null, extra: {} } satisfies ProviderProbeResult));
    const broken = makeProvider({
      id: "primary",
      version: "1",
      kinds: ["image"],
      extensions: ["png"],
      mimeTypes: [],
      capabilities: ["probe"],
      priority: 100,
      runtime: "node",
    }, {
      health: async () => ({ ok: false, detail: "missing runtime" }),
      probe,
    });
    const healthy = makeProvider({
      id: "fallback",
      version: "1",
      kinds: ["image"],
      extensions: ["png"],
      mimeTypes: [],
      capabilities: ["probe"],
      priority: 10,
      runtime: "node",
    }, {
      probe,
    });
    registry.register({ provider: broken, dispose: broken.dispose });
    registry.register({ provider: healthy, dispose: healthy.dispose });

    const { result, meta } = await invokeProbe(registry, {
      path: "C:\\f.png",
      kind: "image",
      extension: "png",
      size: 10,
    });
    expect(result.width).toBe(1);
    expect(meta.providerId).toBe("fallback");
    // 不健康的 primary 在 invoke 时绝不被调用。
    expect(probe).toHaveBeenCalledTimes(1);
    registry.dispose();
  });
});
