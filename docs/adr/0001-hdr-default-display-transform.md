# HDR 默认显示变换按文件头解析，默认路径省略显式参数

HDR（EXR/HDR）预览的默认显示变换（UI 标签「sRGB（默认）」，线协议值 `linear-srgb`）按文件头声明的色彩空间解析输入（ACEScg 头 → ACEScg，否则 linear），再做线性→sRGB 显示；默认路径的预览 URL 省略 `inputColorSpace`/`displayTransform` 参数，与序列暂存解码共享同一缓存变体，仅显式选择 aces-1.3/aces-2.0/raw 或配置 OCIO 时才携带参数生成独立变体。

Status: accepted

Considered options: 旧行为对默认路径显式携带 `inputColorSpace=lin_srgb`，会把 ACEScg 文件按 linear 误解码，且与显式路径产生重复缓存变体。备选「仅当文件头为 linear 时去重」需要渲染端预知文件头，放弃。
