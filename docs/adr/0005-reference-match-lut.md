# ADR-0005: 参考图仿色（reference match）的移植与落地

- 状态：已接受
- 日期：2026-10-28
- 关联：`docs/adr/`；上游项目 https://github.com/xrz1411/reference-match（MIT，© 2026 xrz）

## 背景

用户希望在 RefCanvas 里直接用一张参考图给当前画面「仿色」，并导出可给调色软件
使用的 3D LUT。上游 `reference-match` 是一个本地 WebUI：导入参考图与一张视频
静帧，在 OKLab 里拟合亮度分布与分区色度分布，产出 33/65 点 Resolve `.cube`。
它的运行时是 Python + numpy + PyTorch，不能直接进 Electron 渲染进程。

## 决策

### 1. 匹配内核重写为纯 TypeScript

`src/shared/match/` 承载全部数学，无 Node/Electron 依赖，便于单测与将来复用：

| 模块 | 职责 |
| --- | --- |
| `colour.ts` | sRGB↔线性、Rec.709 Gamma 2.4、OKLab 正反变换 |
| `global-match.ts` | 亮度分位曲线 + 明暗三分区色度分布匹配，烘焙成残差 LUT |
| `look-controls.ts` | 匹配强度、分区权重、肤色/饱和/对比三条保守护栏 |
| `residual-lut.ts` | 残差体存储 `[channel][blue][green][red]`、三线性采样、`.cube` 序列化 |
| `reference-analysis.ts` | 参考图主色板（确定性 k-means）、亮度分位、饱和度、色相族 |

存储用交错 RGB 三元组（每个格点一次偏移），`.cube` 写出时按 Resolve 约定改成
红最快、写最终值而非残差。

### 2. 与上游的数值一致性靠交叉校验锁住

`tests/fixtures/match/reference-match-cases.json` 由上游 Python 函数生成，
`port-parity.test.ts` 逐点比对残差与采样结果，当前最大误差 8.5e-5。这一步抓到过
两个真实缺陷：上游先把输入裁剪到 0..1 再算 OKLab；以及残差存储顺序是通道优先
而非像素交错。没有这层校验，两条都不会暴露。

### 3. 一处刻意的行为偏离：退化色度轴

当源图某个色度轴几乎没有分布（灰墙、阴天素材，`a`/`b` 全在 1e-11 量级），上游
会在几近为零的区间上做数百段插值，等于把浮点噪声放大成随机偏色。这里的实现把
该轴的映射塌缩成参考中位数一个常数响应：行为稳定、可复现，但不再与上游逐点
相同。这类输入在实拍素材里很常见，稳定性优先。

### 4. 预览由主进程渲染，不引入 GPU 通路

匹配结果与「导出 LUT 再套用」必须是同一份变换。主进程拿到参数后：解码（sharp，
视频用既有 `extractVideoFrame`）→ 拟合 → 直接对内容帧应用残差 → 写 PNG 到缓存
目录并签发 `refbrowse://preview/` 令牌。渲染端只负责显示与分屏对比。

未采用「渲染层 WebGL 采样 3D 纹理」的原因：预览位图来自自定义协议，纹理上传
要先解决跨源污染；而主进程路径与现有的位图生成架构一致，且不存在两套实现的
漂移风险。滑杆用 160ms 合并窗口 + 主进程解码缓存，交互延迟在一帧到两帧之间。

### 5. 参数与产出的缓存键

`sha256(源路径:size:mtime : 参考路径:size:mtime : timeMs : previewSize : dimension : JSON(controls))`
前 24 位。缓存文件同时登记到预览缓存索引，跟随既有淘汰策略自动清理。

### 6) 交互性能是需求的一部分

实测（4000×3000 源图 + 1200×800 参考图，预览 1280px）：

| 阶段 | 优化前 | 优化后 |
| --- | --- | --- |
| 冷启动（解码 + 拟合 + 渲染） | 2.1 s | 0.52 s |
| 拖动滑杆单次更新 | 2.0 s | 约 135 ms |
| 同参数重访 | 2 ms | 3 ms |

三层指纹拆开之后，观感参数变化不必重拟合（拟合约 190ms），只重做 14ms 的控制与
一次渲染；显示域转换改成 4097 点查表，近黑区仍走公式，误差 <1e-5（有单测锁定）；
渲染与 sRGB 编码合并成一次遍历，去掉了百万级临时数组。面板请求 1024px 预览，
因为托盘宽度只有四五百像素。

## 同步修好的既有缺陷：`activeLut` 不作用于预览

修复前：`activeLut` 只进 `media:thumbnail` 的缓存键与 ffmpeg 分支，而预览面板大图
走 `refasset://thumbnail` 协议，`generateThumbnail` 没有 LUT 入参，缓存键也不含
LUT 签名；且 `applyLut3dToPng` 用 `-f image2` + 未知扩展名（`*.lut-tmp`）输出，
ffmpeg 会猜成 mjpeg，把 JPEG 字节塞进 `.png` / `.webp` 缓存文件。这个功能在用户
手上从来没有生效过，还埋了一个格式错位。

修复：

1. `ffmpeg-tools.ts` 新增 `applyLut3dImage`：`lut3d=file='<escaped>'` 命名参数 + 单引号
   转义，显式指定 `-c:v png` / `-c:v libwebp`，临时文件名与编码器一致；含单引号的
   路径先复制到临时目录（ffmpeg 6.1 无法表达该字符）。
2. `refasset://thumbnail` 读取 `activeLut`，把 LUT 签名（路径 + mtime + size）并进
   缩略图缓存键，换 LUT 自动换键；白板代理与图标类资产（音频/字体/文本/3D）不参与，
   避免给占位卡片上色。
3. 应用 LUT 失败时降级为未调色图并删除 LUT 专属缓存文件，错误只打日志、不进负缓存，
   否则一次偶发失败会让预览永久 404。
4. 套了 LUT 的响应改 `Cache-Control: no-store`：URL 不变而磁盘缓存变了，不绕开浏览器
   缓存就会卡在旧画面。配合渲染层在 `activeLut` 变化时重挂预览组件。

代价：启用 LUT 后首次浏览某目录，每张缩略图多一次 ffmpeg 调用（几十毫秒），之后命中
磁盘缓存。这是用户显式开启的全局行为，可以接受。

## 影响

- 新增 `media.matchAnalysis / matchCreate / exportMatchLut` 三个 IPC 与一个托盘面板
  （预览工具栏 → LUT → 参考图仿色），面板内可直接导出 `.cube` 并一键设成预览 LUT。
- LUT 菜单本身从「只作用于不存在的调用链」变成真的作用于预览大图与缩略图。
- 测试：内核 43 个单测 + 上游交叉校验夹具；主进程服务 8 个（含真 ffmpeg 视频抽帧）；
  LUT 链路 9 个（含真 ffmpeg + sharp 往返）；面板 3 个。

## 仍未覆盖

- Electron `protocol.handle` 分支本身没有端到端测试（依赖运行时），只有纯判定表、
  缓存键与 ffmpeg/sharp 环节的单测；真实 LUT 菜单点选需要人工或打包冒烟验证。
- 参考图分析只支持本地能解码的位图（选择器也只开放常见位图格式）。

## 备选方案

- 直接调用上游 Python 解释器：需要用户自备 Python 与 PyTorch，与「纯本地开箱即用」
  的定位冲突，未采纳。
- 用 ffmpeg 的 `lut3d` 反解做拟合：无法表达 OKLab 分区匹配，精度与语义都不够。
- 只做算法不做界面：核心是一张表，不呈现就无从判断风格是否可用。

## 追加：工作空间、DPX 与独立面板（0.40.0）

上游除了「Rec.709 显示域里套一张 LUT」，还支持三种输入工作空间与 DPX 原生读取。
这一轮把这些补齐，并把工具从预览托盘挪成独立面板。

### 2. 色彩管理单独成模块

`src/shared/match/colour-management.ts` 承载三套输入域的正反变换：

| 函数 | 用途 |
| --- | --- |
| `dwgIntermediateToRec709Gamma24` / `rec709Gamma24ToDwgIntermediate` | DWG + DI ↔ 显示域，矩阵取自 Blackmagic 规范 rev 1.1 |
| `slog3ToRec709Gamma24` | S-Log3 → SDR 显示，含 S-Gamut3 / S-Gamut3.Cine、full/legal |
| `slog3ToDisplayMatchDomain` | 优先 Sony LC-709 Look Profile，缺失时退回解析式还原 |
| `resolveDwgToRec709Gamma24` / `precompensateDwgForResolveRec709` | Resolve 709 输出响应的正/逆曲线 |
| `bakeDwgIntermediateResidual` / `bakeSlog3ToRec709Residual` | 把显示域残差烘进对应工作空间的 cube |
| `parseBaselineCube` | 读取用户提供的 Sony LC-709 cube（不可再分发，不进仓库） |

三种流程的行为差异（与上游一致）：

- **Rec.709**：拟合域就是 cube 域，导出夹 0..1。
- **DWG + DI，DPX 源**：栅格直接建在 DI 里，参考图先转进同一空间；可选烘入 Resolve 709 补偿；导出不夹 0..1。
- **DWG + DI，普通位图源**：仍在显示域拟合，再烘进 DI（`bakeDwgIntermediateResidual`），高亮度区按 gate 回退成恒等。
- **S-Log3**：只接受 DPX；先用基线还原到显示域拟合，再把整条链烘回 S-Log3 → 显示的直通 cube（后面不要再接 CST）。

预览与 cube 走同一条变换：这是「所见即所得」的唯一保证，也是我们不把预览
交给渲染层另算一遍的原因。

### 3. DPX 读取

`decodeImageToRgb48` 用打包的 ffmpeg 以 `rgb48le` 解码，不经任何传输曲线、不做
缩放；DPI 级细腻度靠整数步长最近邻抽样降到预览尺寸，避免在码值域里插值。
参考图仍然只接受 sRGB 静帧，DPX 会被明确拒绝。

### 4. 示波器在主进程算

直方图（256 桶 → 7 点二项式平滑 → 64 段）与 Cb/Cr 密度（128²）由
`analyseScopes` 在同一份解码样本上算出，随分析结果一起返回。上游是在浏览器里
对已显示图像重算的，那样得到的数值和拟合看到的像素不是同一批；放到主进程后
渲染端退化成纯画图，也便于单测。

### 5. 从托盘工具升为独立面板

托盘只有四五百像素宽，分屏对比、色板、示波器、参数与设置挤在一列里已经到极限。
现在 LUT 菜单的「参考图仿色…」打开一块独立面板（`ReferenceMatchPanel`）：左侧
画面 + 示波器，右侧参数，宽窄由容器查询自动切换单/双列。面板里补上导出 PNG、
导入 Resolve LUT 库（写进 `<库>/Reference LUT/`，重名报错）、产出目录设置、
Resolve 709 补偿开关与缓存清理。

### 验证

`tests/unit/shared/match/colour-management-parity.test.ts` 与上游 Python 实现逐点
交叉校验（夹具 `tests/fixtures/match/colour-management-cases.json`）：DWG↔显示、
S-Log3 三种组合、Resolve 输出模型均在 1e-5 量级，DWG 直拟残差体在 2e-4 量级。
两处刻意放宽并写明原因：DI 的 log 编码在近黑区把 float32/float64 差异放大到
5e-4；超过 1.0 的宽色域码值在双向矩阵往返中只剩浮点噪声，不予比较。
