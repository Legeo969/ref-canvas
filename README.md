# RefCanvas

当前版本：0.38.0

Windows-first、纯本地的磁盘原生媒体浏览器与无限参考白板。

## 当前能力

- 磁盘/NAS 是唯一文件真相；挂载根目录后直接浏览真实目录树，不需要导入或复制源文件。
- 默认工作区是磁盘 Grid + 格式 Inspector；Fabric 参考板是独立可切换工作区。
- SQLite 只保存可重建索引、缓存、标签、评分、备注、保存搜索和白板引用。
- 目录浏览支持前进/后退、面包屑、分页、虚拟列表、搜索、排序、隐藏文件和按目录记忆的 flattening。
- 文件操作支持新建目录、重命名、复制、剪切、粘贴、跨目录移动、冲突处理和 OS 回收站。
- 图片序列按单个片段折叠，支持帧范围、缺帧信息、FPS 预览和 MP4 导出。
- 图片、视频、音频、EXR/HDR、glTF/GLB/OBJ/FBX/STL、PDF、文本、字体与 DCC 文件提供本地预览或明确降级。
- Three.js 负责 3D、EXR/HDR 和 tone mapping；内置 FFmpeg/FFprobe 负责视频、音频和序列处理。
- 格式 Inspector 显示通用文件信息以及视频、音频、序列、HDR 和 3D 专用 metadata。
- 磁盘索引支持标签、收藏、评分、颜色、保存搜索、断链定位和重复项检查。
- 后台索引、媒体和 provider worker 由 supervisor 隔离；worker 失败不会带崩主进程。
- 本地 Python/Shell scripts 采用 trust hash，不执行未信任或已变化的脚本。
- `BoardDocumentV3` 无限白板支持独立背景与网格、吸附、对齐、分布、锁定、组合、蒙版、透明度、图层、跨白板复制、富文本便签和 3D 代理预览。
- 白板引用使用路径 + fingerprint；移动后自动重连，多候选时保留缺失对象并要求手动选择。
- 支持白板多窗口、PNG/JSON/显式项目收集、Tab 专注模式和 F11 展示模式。
- 支持本地备份、完整性校验、诊断包、托盘退出、UI scaling 和可选全局快捷键。

所有索引与白板数据均保存在本机。分享服务、HTTP/QR、密码访问、浏览器扩展、云同步和账户服务不在当前版本范围内。

## 数据安全

- 浏览、索引和添加 metadata 都不会复制或移动源文件。
- 删除默认调用 OS 回收站；应用不提供默认永久删除入口。
- mount 离线时保留索引和引用，不把暂时不可访问误判为批量删除。
- 自动备份只包含数据库、设置和白板，不包含源素材。
- 卸载程序默认保留用户数据库。

## 快捷键

- `Ctrl+K`：聚焦素材搜索
- `Ctrl+Shift+P`：打开白板命令面板
- `Ctrl+A`：选择当前全部筛选结果（素材面板）
- `Alt+拖动素材`：将选中素材的源文件拖到外部程序
- `Ctrl+C / Ctrl+V`：跨白板复制粘贴对象
- `Ctrl+G / Ctrl+Shift+G`：组合/取消组合
- `Ctrl+Z / Ctrl+Y`：撤销/重做
- `Space`：聚焦选中图片/返回原视图；聚焦时 `←/→` 浏览前后图片
- `Tab`：专注白板
- 可选全局快捷键：`Ctrl+Shift+C` 捕获剪贴板，`Ctrl+Shift+R` 区域截图
- 透明穿透模式紧急退出：`Ctrl+Alt+Shift+R`

## 开发

```powershell
pnpm install
pnpm check
pnpm start
pnpm check:release
```

`pnpm check` 是日常变更门禁（仓库卫生、ESLint、类型检查、架构边界、单元与集成测试）；
`pnpm check:release` 额外执行性能 smoke 与 Electron 打包。该门禁通过
[`.github/workflows/check.yml`](.github/workflows/check.yml) 在每次推送与 PR 上强制执行，
不再依赖本地自觉。架构边界和后续拆分计划见
[`docs/architecture/overview.md`](docs/architecture/overview.md)。

执行完整发布门禁并生成 Windows 安装程序、ZIP、版本与 SHA-256 manifest：

```powershell
pnpm release:windows
```

发布文件写入 `D:\AiWork\ref-canvas-releases\<version>`，仓库只保留 release notes 和 manifest。

Windows 代码签名可通过以下环境变量启用；未设置时生成 unsigned 本地安装包：

```powershell
$env:REFCANVAS_CERTIFICATE_FILE="C:\path\certificate.pfx"
$env:REFCANVAS_CERTIFICATE_PASSWORD="..."
pnpm release:windows
```
