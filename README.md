# RefCanvas

Windows-first、纯本地的磁盘原生媒体浏览器与无限参考白板。

磁盘与 NAS 是唯一的文件真相:挂载根目录后直接浏览真实目录树,不需要导入或复制源文件。SQLite 只保存可重建的索引、缓存、标签、评分、备注与白板引用;所有数据都留在本机。

## 核心特性

### 磁盘浏览

- 默认工作区是磁盘网格 + 格式 Inspector;多标签页浏览,支持前进/后退、面包屑、分页、虚拟列表、搜索、排序与按目录记忆的 flattening。
- 文件操作覆盖新建目录、重命名、复制、剪切、粘贴、跨目录移动、冲突处理与 OS 回收站。
- 图片序列按单个片段折叠,支持帧范围、缺帧信息、FPS 预览与 MP4 导出。
- 索引支持标签、收藏、评分、颜色、保存搜索、断链定位、相似图检索与重复项检查。
- 集合面板与侧栏快速访问;浏览器扩展(Chrome/Edge MV3)把网页图片直接捕获进参考板,自动归档进「网页捕获」集合。

### 参考白板

- 无限画布:独立背景与网格、吸附参考线、对齐、分布、等比归一、紧凑排列与按名称/时间/路径排列;排列参数(间距/对齐/倒序)有独立设置面板。
- 工具按七个功能组平铺,窄窗口自动换行,可一键收起为单行核心组;所有命令都能在命令面板(`Ctrl+Shift+P`)里找到。
- 图片管理:非破坏性裁切、蒙版、透明度、锁定、组合/层级、富文本便签、清单、GIF 播放控制、3D 代理预览与逐对象备注。
- 引用使用路径 + fingerprint;文件移动后自动重连,多候选时保留缺失对象并要求手动选择。
- 空白板提供引导层;工具栏「添加文件」按钮走系统文件选择框;目录网格的图片可以直接拖到侧栏白板条目上板。
- 支持独立白板窗口(弹层打开期间自动置顶,不被宿主窗口遮挡)、画布锁定、画布级灰度、PNG/项目包导出、Tab 专注模式与 F11 展示模式。

### 预览与检查

- 图片、视频、音频、EXR/HDR、glTF/GLB/OBJ/FBX/STL、PDF、文本、字体与 DCC 文件提供本地预览或明确降级。
- 参考图仿色:导入一张参考图即可把它的色板、亮度与对比关系拟合到当前画面,分屏对比确认后导出 33/65 点 Resolve `.cube`;匹配强度、暗/中/高三分区权重与肤色/饱和/对比保护均可调。
- Three.js 负责 3D、EXR/HDR 与 tone mapping;内置 FFmpeg/FFprobe 负责视频、音频与序列处理。
- 格式 Inspector 显示通用文件信息以及视频、音频、序列、HDR 与 3D 专用 metadata。

### 安全与隔离

- 后台索引、媒体和 provider worker 由 supervisor 隔离;worker 失败不会带崩主进程。
- 本地 Python/PowerShell 脚本:注册前确认路径、sha256 与将执行的命令行;运行前重新校验 hash(内容被改即拒跑)并校验工作目录范围,超时自动杀进程树。

分享服务、HTTP/QR、密码访问、云同步与账户服务不在设计范围内。

## 数据安全

- 浏览、索引和添加 metadata 都不会复制或移动源文件。
- 删除默认调用 OS 回收站;应用不提供默认永久删除入口。
- mount 离线时保留索引和引用,不把暂时不可访问误判为批量删除。
- 自动备份只包含数据库、设置和白板,不包含源素材。
- 卸载程序默认保留用户数据库。

## 快捷键

- `Ctrl+K`:聚焦素材搜索
- `Ctrl+Shift+P`:打开白板命令面板
- `Ctrl+A`:选择当前全部筛选结果(素材面板)
- `Alt+拖动素材`:将选中素材的源文件拖到外部程序
- 空格+左键拖拽:平移画布;轻按 `Space`:聚焦选中图片/返回原视图(聚焦时 `←/→` 浏览)
- `Ctrl+点击`:加选/移出选择
- `Ctrl+C / Ctrl+V`:跨白板复制粘贴对象
- `Ctrl+D`:创建副本
- `Ctrl+G / Ctrl+Shift+G`:组合/取消组合
- `Ctrl+[ / Ctrl+]`:图层下移/上移一层
- `Ctrl+Z / Ctrl+Y`:撤销/重做
- `Tab`:专注白板
- 可选全局快捷键:`Ctrl+Shift+C` 捕获剪贴板,`Ctrl+Shift+R` 区域截图
- 透明穿透模式紧急退出:`Ctrl+Alt+Shift+R`

PureRef 交互预设还提供按住 `Z/C/V/S/D` 的连续手势(缩放/裁切/裁切平移/取色/定位),可在设置中切换交互预设并自定义快捷键。

## 开发

```powershell
pnpm install
pnpm check
pnpm start
pnpm check:release
```

`pnpm check` 是日常变更门禁(仓库卫生、ESLint、类型检查、架构边界、单元与集成测试);`pnpm check:release` 额外执行性能与容量 smoke、Electron 打包与运行时冒烟。该门禁通过 [`.github/workflows/check.yml`](.github/workflows/check.yml) 在每次推送与 PR 上强制执行。

领域词汇表见 [`CONTEXT.md`](CONTEXT.md),架构决策记录见 [`docs/adr/`](docs/adr/)。

执行完整发布门禁并生成 Windows 安装程序、ZIP 与 SHA-256 manifest:

```powershell
pnpm release:windows
```

发布文件写入仓库同级的 `ref-canvas-releases/<version>` 目录(可用 `REFCANVAS_RELEASE_DIRECTORY` 覆盖),仓库只保留 manifest(`docs/releases/`)。

Windows 代码签名可通过以下环境变量启用;未设置时生成 unsigned 本地安装包:

```powershell
$env:REFCANVAS_CERTIFICATE_FILE="C:\path\certificate.pfx"
$env:REFCANVAS_CERTIFICATE_PASSWORD="..."
pnpm release:windows
```
