# GIF 预览播放修复复盘（postmortem）

> 状态：已修复并验收（0.38.5）。记录排查链、根因与经验，避免同类问题重演。

## 现象

右侧预览窗口 / 白板双击 GIF 弹窗里：
- GIF 动画停在第一帧，不播放；
- 暂停不冻结在当前帧、或停在错误帧；
- 拖进度条滑块不跟手，Console 报 `Maximum update depth exceeded`。

## 排查时间线（关键证据）

| 阶段 | 现象 | 判定 |
| --- | --- | --- |
| 1 | 进度条/时间码不动 | 缺权威时长：image provider 对 GIF 返回 null → `media:probe` / `library-service` 对 GIF/APNG 走 ffprobe 补齐（01_v002.gif = 6.87s） |
| 2 | 暂停黑屏 | 试过在动画 `<img>` 上盖 canvas 叠加层画 VideoFrame → 失败/翻转。**教训：不要贴 canvas 盖原生动画** |
| 3 | 暂停不冻结 | 用同步 canvas 抓帧（`renderImageToDataUrl`）替代异步 ffmpeg；拖动用本地解码帧绘制、不逐次走 IPC |
| 4 | `Maximum update depth exceeded` | transport 每次快照变化都 unregister→register（null 闪烁 + 双倍 re-render）→ 拆分 registry/state context + `memo(AssetPreview)` + 节流 `setNativePosition` + 幂等注册 |
| 5 | **决定性证据** | `decode:tracks {frameCount: 1, dataBytes: 14148056}`：body 完整（14MB 全到），但 **ImageDecoder 只认 1 帧**；`decode:ok … Array(1)`；`tick:canvas index:0` 恒定不变；原生 `<img>` 同样停首帧 |
| 6 | 磁盘实测 | ffprobe 直接验证文件：**165 帧 / 24fps / 6.87s**，文件本身没问题 |
| 7 | 结论 | 这套 Electron 的 Chromium GIF 解码器（WebCodecs `ImageDecoder` 与 `<img>`）对大型 GIF 只解出第一帧 |

## 根因（三层叠加）

1. **时长缺失**：GIF 属 `image` kind，image provider 不带时长 → ffprobe 兜底。
2. **传输截断风险**：`refasset://` 以 `stream: true` 特权注册；`fileProtocolResponse` 一直返回**流式 body**，Chromium 图片解码器对大文件可能只拿到首片 → 图片（≤64MB）改**整包缓冲返回**，Content-Length 精确。（此修复后 `dataBytes` 才变成完整 14148056）
3. **解码器写死 1 帧**：即便全量字节在手，`ImageDecoder` 仍报 `frameCount: 1` → **彻底弃用 Chromium 的 GIF 解码器**，改主进程 ffmpeg 拆帧。

## 最终方案（`media:gifFrames`）

- 主进程 ffmpeg 把 GIF/APNG 拆成逐帧 PNG：
  `ffmpeg -i in.gif -vsync 0 -f image2 <dir>/frame_%04d.png`（实测 165 帧约 0.6s）。
- 缓存：`<thumbnailCache>/gif-frames/<sha256(path+size+mtime)>/manifest.json`，size+mtime 未变即复用，避免每次打开重拆。
- 交付：`refbrowse://preview/<token>` 逐帧 URL（token 会话级、路径不出现在 URL）。
- 渲染端：`ImageDecoder` 出 ≤1 帧时转调 `media:gifFrames` → 分块并发 `loadImage` + `createImageBitmap` → 每帧 uniform 100ms（配合 ffprobe 权威总时长驱动播放）→ canvas 位图播放。
- 播放/暂停定格/从暂停处续播/拖动/逐帧全部基于**真实 165 帧位图**。

## 经验教训

1. **拿到日志再动手**：渲染端/主进程都要打路径决策日志（能用 Console 一眼看出走到哪条路：解码成功？走了回退？帧数多少？）。盲改三次不如一次完整日志。
2. **关键证据要对数**：帧数、字节数、时长、frameCount 这些数字，直接推翻/证实假设，别靠感觉。
3. **浏览器内核能力不当作保证**：`ImageDecoder`/`<img>` 对 GIF 动画的支持依赖内核版本与文件形态；关键路径用 ffmpeg（已证可靠）兜底。
4. **Electron 自定义协议易踩坑**：scheme 特权（`stream` / `supportFetchAPI`）与 Response 形态（流式 vs 缓冲）会直接影响图片解码器实际拿到的 body。
5. **React 重渲染风暴**：跨组件状态广播要幂等（相同快照不重复 push）、避免 unregister→register 的 null 闪烁；大组件用 `memo` 隔离；连续操作节流。
6. **单位不一致处理**：ImageDecoder 帧时长单位不稳定（µs/ms），但任一帧的“相对比例”映射（ratio → frameIndex）天然不受单位影响，进度/时间码统一用真实时钟。
7. **连续操作绝不逐次走 IPC**：拖动每一下都开 ffmpeg 会造成进程风暴卡死 UI；本地解码帧即时绘制 + 分块并发加载。

## 关键文件

- `src/main/ipc/resources-ipc.ts` — `media:gifFrames` / `media:probe` / `media:frame`
- `src/main/services/media/ffmpeg-tools.ts` — `extractGifFramesToDirectory`
- `src/main/platform/protocol-file-response.ts` — 图片整包缓冲返回
- `src/main/services/library-service.ts` — GIF ffprobe 时长兜底
- `src/renderer/components/GIFPreview.tsx` — canvas 逐帧播放
- `src/renderer/components/PreviewTransport.tsx` — 幂等注册

## 附：目录缩略图「切窗口回来重载」复盘（同批次修复）

### 现象
- 目录缩略图在切走再切回窗口后闪「加载」（占位图再出图）；滚动/导航时也会反复闪。

### 排查链（三层假设逐一被日志证伪/证实）
1. **假设 URL 变了** → 渲染端每次重建 `refbrowse://thumbnail/<token>?priority=...` 且 `priority` 翻转 → 已修：会话级 token 缓存 + 固定 URL（不随 priority 重建）。但仍重载。
2. **假设 HTTP 缓存丢了** → 自定义协议响应原来无缓存头，Chromium 不缓存 → 已修：`protocolResponseHeaders` 加 `Cache-Control: private, max-age=300`（图片为整包缓冲，可缓存）。但仍重载。
3. **埋点证明**（`[ThumbDebug:panel/card/img]`）：面板并未重挂（只在启动时 StrictMode 双挂一次）；**卡片被虚拟化反复 mount↔unmount**（滚动/导航/切窗口都会触发），每次重挂 `useRetryingPreviewUrl` 都把状态重置回 `loading` → `<img>` 重挂 + 占位图闪烁。真正的问题是**状态随重挂丢失**，不是 URL 或传输。

### 修复
- `useRetryingPreviewUrl` 增加**会话级「已加载 URL」集合**：同一 URL 已 `ready` 过，重挂时直接以 `ready` 起步，不再闪 loading；图片本体由 HTTP/磁盘缓存瞬时出图。
- 该 hook 被目录缩略图、预览面板、序列卡共用，一处修复多处生效。
- 配套：缩略图 URL 稳定（token 复用 + 不随 priority 重建）、协议响应可缓存（max-age + 不缓存失败响应）、`media:frame` 缓存键补 size+mtime、`gif-frames` 目录跳过孤儿清理并做 LRU 上限修剪。

### 经验
- **有了日志要逐层证伪**：先排除「URL 变 / 传输丢缓存」这两类显然的原因，再用埋点确认是「组件重挂」——避免把「网络/协议问题」当根因修半天。
- 虚拟化/列表组件会高频重挂卡片是正常行为；**凡是重挂会重新触发的状态（loading/ready、token、订阅）都要考虑会话级缓存**，用「已就绪即直接 ready」的方式消除闪烁。

## 遗留 / 风险

- 拆帧按 24fps 均匀分发；对非常规变长帧延迟的 GIF，时间码是近似（如需精确可把每帧延迟也随 manifest 返回）。
- 拆帧缓存键为 `path+size+mtime`，同名不同内容会各自缓存。
- 超过 64MB 缓冲上限的图片仍走流式返回；若再遇首帧问题需上调上限或直接对 GIF 走拆帧专供。
- 协议响应 `max-age=300` 无 ETag/304：过期后整包重验；文件变更后重开预览最多 5 分钟后拿新图（主要路径按 mtime 换键，实际影响有限）。
- `readyPreviewUrls` 为会话级内存集合：随浏览累积（量级 = 看过多少张图，几 KB），关窗即清；不设上限不构成问题。
