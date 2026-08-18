# 缩略图缓存编码从 PNG 改为 WebP

缩略图缓存全链路（worker、placeholder、blend 内嵌预览、nativeImage 回退、EXR/HDR/视频/PSD/音频/字体/文档/3D provider）统一输出 WebP（`quality: 85` 有损），替代原先的 PNG。缓存键 variant 字面量从 `-png` 改为 `-webp`（`preview-cache-key.ts`），`PREVIEW_CACHE_VERSION` bump 到 `preview-v6` 使旧 PNG 缓存自然失效重建；缓存文件扩展名 `.png`→`.webp`，协议响应头 `image/png`→`image/webp`。用户自定义缩略图（`customThumbnailPath`，`protocols.ts` 两处）保持原样返回 PNG，不转码。

Status: accepted

Considered options: 旧实现所有分支产物为 PNG，照片/实拍素材（shotdeck JPG、Unreal 渲染帧）压缩率差，WebP 有损小 50%+、无损小 25-35%。备选「只改 worker + 3 处响应头」不可行：`generateThumbnail` 有多个分支（worker/placeholder×3/blend/nativeImage/registry provider）全部输出 PNG，响应头统一 webp 后任何仍返回 PNG 的分支会产生 `Content-Type: image/webp` + PNG 字节流，浏览器解码失败。备选「响应头按产物动态判断」要求缓存命中时已知格式，而 `readFile(cacheFile)` 返回裸字节，等价于强制全链路统一格式，无额外收益。备选「保留 PNG 但收紧质量」压缩率仍不及 WebP，且 PNG 无原生有损模式。blend 内嵌预览分支原先不写 cacheFile（每次重新解码），本次顺带补 `writeCacheAtomically` 落盘。hdr-provider 的 `publishTemporaryPng` 改为 sharp 转码（ffmpeg/oiiotool 仍输出 PNG 临时文件，统一转 webp 落盘），oiiotool 直解码路径改为 sharp 直写 webp 省去 PNG 中转。
