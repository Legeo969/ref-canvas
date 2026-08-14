# RefCanvas 上下文

RefCanvas（`ref-canvas`）是 Windows 优先、纯本地的磁盘原生媒体浏览器与无限参考白板。本文件是本仓库的领域术语表（glossary），只记录「是什么」，不记录实现细节。

## 工作区

**参考白板 (reference board)**:
基于 Fabric 的无限画布工作区，用于摆放、布局素材参考。独立于默认工作区，可切换。

**磁盘网格 (disk grid)**:
默认工作区中按目录浏览磁盘素材的网格视图；与之配套的是格式检查面板（README 称「格式 Inspector」）。

**资产 (asset)**:
磁盘上的一个媒体文件（图片、视频、GIF、EXR/HDR、序列、3D 等），是浏览与预览的最小单元。
_Avoid_: 素材条目、目录项、media

## 预览

**预览面板 (preview panel)**:
应用右侧的素材预览面板，含 tab 栏（预览 / AI）与工具栏；视觉版式参照外部设计参考「Found」，但「Found」不是本应用的领域概念。
_Avoid_: Found 面板、详情面板、DirectoryDetailsPanel、workbench 面板

**预览会话 (preview session)**:
预览面板的呈现状态，有聚焦 (focused) 与全屏 (fullscreen) 两个独立的轴。

**演示模式 (presentation mode)**:
原生 F11 全屏，仅适用于参考白板；与预览会话的全屏无关。

**沉浸模式 (immersive)**:
聚焦或全屏下隐去界面镶边的媒体优先呈现；全屏下控件随指针移动显隐、静止时自动隐藏。

**序列组 (sequence group)**:
被识别为同一图像序列的一组文件，拥有整体帧率与首末帧概念。

**帧率 (frame rate)**:
图像序列播放的绝对每秒帧数（fps）。
_Avoid_: 播放速度、倍率

**播放速度 (playback speed)**:
视频播放的倍率（0.25×–2×）。
_Avoid_: 帧率、fps

## 颜色

**取色 (eyedrop / color sampling)**:
从预览媒体上吸取单个像素的颜色（吸管）。
_Avoid_: 吸色、像素取色、sample

**调色板 (palette)**:
从媒体内容提取的主色调集合，显示为固定色板。
_Avoid_: 色彩栏、固定色板

**采样色 (sampled swatches)**:
由取色产生的、按时间累积的颜色序列。
_Avoid_: 采样色板

**显示变换 (display transform)**:
HDR（EXR/HDR）解码后呈现到屏幕的变换选择：`sRGB（默认）`（UI 标签；线协议值 `linear-srgb`；输入色彩空间按文件头解析）、`aces-1.3`、`aces-2.0`、`raw`。

**OCIO 配置 (OCIO config)**:
可选的 OpenColorIO 配置文件路径，用于自定义色彩管理，优先级高于内置显示变换。

## 工具与视图

**LUT**:
在预览中套用并查看 LUT 效果的工具。

**多通道 (multichannel)**:
EXR 多层 / 多通道的提取与查看视图。

**全景模式 / 反射球 (panorama / reflection ball)**:
HDR 素材的两种查看模式：等距柱状全景与反射球预览。

**上下文工具 (context tools)**:
预览下方的工具托盘：GIF 导出、序列帧导出、资产备注等。
