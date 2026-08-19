# ADR-0004: 参考白板 PureRef 对齐（mipmap 分级 / 导入优化 / 崩溃提示）

- 状态：已接受
- 日期：2026-08-18
- 关联：`docs/enterprise-hardening-spec.md`（SPEC-2 库可移植性之后的白板体验对齐）

## 背景

用户对比了 RefCanvas 参考白板与 PureRef（2.1.3 逆向分析规格），希望补齐三项
PureRef 对齐能力：

1. **mipmap 分级加载**：PureRef 按视口缩放级别只解码当前可见分辨率，缩放时逐级
   切换，从而在 100 张大图下保持内存可控。
2. **导入优化规则**：PureRef 拖入大图时按规则自动降采样/转换/询问。
3. **autosave 崩溃恢复**：PureRef 崩溃后列出可恢复场景。

## 现状分析

RefCanvas 白板已有大量相关基础设施：

- **proxy 分级**：`board-proxy.ts` 提供 512/1024/2048 三档，`protocols.ts` 按
  `?size=` 生成 `board-<size>-webp` 独立缓存变体。`refreshVisibleImageProxies`
  已按缩放**升级** proxy，但**只升不降**（`desired <= current` 直接跳过），
  视口外对象也不降级。
- **即时持久化**：`BoardPersistenceController` 以 500ms debounce 把改动即存到
  boards 表，因此不存在 PureRef 那种"手动保存后崩溃丢数据"的场景。
- **导入**：`addAsset` 一次性定档 proxy，无超大图提示。

## 决策

### 1. mipmap 分级：补降级 + 视口外回收

重构 `refreshVisibleImageProxies`：

- 视口外对象降到最低档（512），滚回时再按需升级——释放高分辨率 proxy。
- 视口内改为**精确匹配**：放大升级、缩小降级，避免长期持有超出显示所需分辨率。

复用既有 `boardProxyUrl` / `setSrc` 管线，不引入新依赖。

### 2. 导入优化规则：超大图自动降档 + 提示

RefCanvas 的 proxy 机制天然不加载全分辨率（从不全尺寸解码），因此"降档"已内建。
增量是**拖入超大图（任一边 > 2048px）时提示用户已自动优化**，在 drop notice 中
追加 `board.importOptimized` 文案。

### 3. 崩溃恢复：改为崩溃检测提示

因白板数据即时持久化，不实现"恢复未保存数据"，而是：

- 主进程 `shutdownServices` 正常退出时写 `cleanShutdown=true` 设置。
- 启动时读取该标记：缺失说明上次异常退出，`startupHealth.previousCrash=true`。
- 渲染端在非 safe/too-new 模式下显示 `app.previousCrash` 横幅提示用户检查白板。

## 影响

- 内存：缩小/滚出视口后高分辨率 proxy 被释放，大图多时内存更可控。
- 体验：超大图导入有明确反馈；异常退出有提示。
- 无新依赖；全部复用既有 proxy / 持久化 / i18n 基础设施。

## 后续扩展：非图片类型显示真实媒体内容

用户反馈视频/PDF/3D/字体/DCC 等导入参考版只显示格式卡片。经确认，
`refasset://thumbnail/<id>` 对**所有非 generic 类型**都会走 provider 生成真实
缩略图（视频 poster 帧、3D 渲染、字体样张、文本卡片、DCC 图标、EXR/HDR 转码），
问题只在 `addAsset` 只对 `kind === "image"` 走图片加载分支。

**决策**：把 `addAsset` 的图片加载条件从 `kind === "image"` 放宽到
`kind !== "generic"`：

- image 保留 proxy 分级 + gif 特判（`boardProxyUrl` + `previewUrl` 回退）。
- 非 image 直接用 `asset.thumbnailUrl` 加载真实缩略图（provider 已生成）。
- 加载失败仍回退格式卡片（try/catch 保留）。
- `refreshVisibleImageProxies` 只对 image 做 proxy 升降级；非 image 用固定
  缩略图，不做 proxy 分级（其 thumbnailUrl 不支持 board proxy variant）。

**验证**：新增 BoardCanvas 测试——mock 一个 `kind: "video"` 资产，断言
`FabricImage.fromURL` 用 `refasset://thumbnail/video-1` 调用、画布出现
FabricImage 而非格式卡片 Group。全量 1092 测试通过。

## 备选方案

- 完整实现 PureRef 式"手动保存 + autosave 恢复对话框"：因 RefCanvas 已即时持久化，
  收益低、复杂度高，未采纳。
- 导入时弹确认对话框询问是否降档：打断批量拖放流程，改为静默降档 + 提示。
