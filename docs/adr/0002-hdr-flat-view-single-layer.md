# HDR 平面视图不再叠加客户端 WebGL 画布

HDR（EXR/HDR）平面视图（flat）只显示主进程生成的显示变换 PNG（`<img class="hdr-preview-fallback">`），不再叠加 Three.js WebGL 画布重绘同一张图。曝光经 CSS `filter: brightness(var(--hdr-exposure))` 作用于 `<img>`；色调映射 / OCIO / 通道提取都是预览 URL 的服务端变体。WebGL 仅保留给全景 / 反射球模式（PanoramaPreview）。

Status: accepted

Considered options: 旧实现用 WebGL 平面把同一张预览 PNG 当纹理重绘。打包环境下 `refbrowse://` 协议对 CORS 图片请求不返回 ACAO，`<img>` 按 no-cors 加载后必然被污染，纹理上传每次抛 `SecurityError`（texSubImage2D: cross-origin data）；未上传纹理的平面渲染为黑/白占位，恰好盖住下方正确的 `<img>`——拖拽面板布局触发连续重渲染时表现为黑屏与序列帧白闪，且每个帧/重渲染循环新建 WebGLRenderer（dispose 不立即释放上下文）导致「Too many active WebGL contexts. Oldest context will be lost」。备选「让协议返回 ACAO 使纹理可上传」不解决上下文流失与逐帧重建渲染器的浪费，且画布只是 `<img>` 的重复渲染，无独立功能，放弃。
