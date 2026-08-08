# RefCanvas 0.38.0 — Found 本地工作流复刻规格

> 状态：Approved for implementation  
> 工作名：`found-clone`（不出现在产品品牌中）  
> 目标版本：RefCanvas `0.38.0`  
> 数据库目标版本：schema `17`  
> 分析基线：Aalab Found `3.5.122`，分析日期 `2026-08-08`  
> 对应实施清单：[found-clone-tickets.md](./found-clone-tickets.md)

<a id="summary"></a>
## 1. 摘要

RefCanvas 0.38.0 要在保留现有 RefCanvas 品牌、磁盘原生架构和 Board 的前提下，补齐 Found 桌面端的本地素材浏览、引用集合、专业预览和 AI Design Supervisor 工作流。实现以行为等价为目标，不复制 Found 的私有代码、资源、协议或品牌。

本版本交付两个可用的 AI Provider：连接本机 ComfyUI 服务，以及连接未来云端服务的 Remote REST 客户端；另提供只在开发和测试环境开放的确定性 Mock Provider。远程服务端不属于本仓库交付范围。

<a id="analysis-evidence"></a>
## 1.1 分析依据、证据等级与洁净室边界

本规格明确引用 `D:\AiWork\gpt-5.6-instruct\found-analysis`。实现与验收使用以下只读材料：

| 分析材料 | 文档中的用途 |
| --- | --- |
| [README.md](../../gpt-5.6-instruct/found-analysis/README.md) | 锁定分析版本、匿名态覆盖边界和测试方法 |
| [EVIDENCE_INDEX.md](../../gpt-5.6-instruct/found-analysis/EVIDENCE_INDEX.md) | 查找运行截图、UI Automation 树和运行时差异快照 |
| [FUNCTION_MATRIX.md](../../gpt-5.6-instruct/found-analysis/FUNCTION_MATRIX.md) | Found 功能清单、验证状态和本规格的覆盖基线 |
| [REPORT.md](../../gpt-5.6-instruct/found-analysis/REPORT.md) | 理解磁盘原生工作流、进程模型、数据流和已观察行为 |
| [VERIFICATION.md](../../gpt-5.6-instruct/found-analysis/VERIFICATION.md) | 确认测试样本、回滚、哈希和无残留条件 |
| [ida/REVERSE_REPORT.md](../../gpt-5.6-instruct/found-analysis/ida/REVERSE_REPORT.md) 与 [MODULE_MATRIX.md](../../gpt-5.6-instruct/found-analysis/ida/MODULE_MATRIX.md) | 仅用于验证高层模块职责和性能约束，不作为代码来源 |

### 证据优先级

发生冲突时按以下顺序裁决：

1. `artifacts/*.png`、对应 `*-tree.json` 与运行时 diff 中直接观察到的行为。
2. `FUNCTION_MATRIX.md` 中标为“动态验证”或“界面验证”的条目。
3. `REPORT.md` 对行为和数据流的归纳。
4. IDA 报告中的高层模块结论，只用于解释约束，不覆盖直接运行证据。

验证状态的实现含义：

- **动态验证**：本地范围内必须实现可观察的行为对等，并用相同类别测试素材验收。
- **界面验证**：必须提供同等目的的入口、状态和参数；内部实现与视觉语言保持 RefCanvas 独立。
- **部分验证**：只把已观察到的入口纳入覆盖，后端行为按本规格独立设计，不宣称复现 Found 未执行路径。
- **代码确认**：不得复用其私有路由或协议；如本产品需要同类能力，必须定义 RefCanvas 自有接口。

### 洁净室实现边界

- 实现者可以阅读上述 Markdown 报告、动态截图、UI 树、运行时快照和自生成 `test-assets`。
- `ida/extracted-ui`、`ida/output/**/functions/*.c`、`*.asm.txt`、`*.i64`、`ida/samples` 和安装目录二进制不得复制、翻译或改写进 RefCanvas。
- 不复制 Found 的 QML/JavaScript、图标、文案、数据库 SQL、路由名、事件编号、插件 ABI、云 API 或二进制资源。
- 可以采用报告指出的通用架构思想，但所有类型、schema、IPC、算法和 UI 代码必须基于 RefCanvas 现有 Electron/React/TypeScript 架构独立设计。
- 代码评审若发现新增实现含 Found 专有名称、私有路径、反编译符号或逐行等价片段，该 ticket 不得验收。

### “复刻完成”的定义

本规格中的 clone 指**功能对等与交互结构对等**，不是源代码还原或 Found 品牌的像素级复制。完成声明必须同时满足：

1. `FUNCTION_MATRIX.md` 中属于本规格范围的每一项都能映射到一个 Ticket 和至少一条完成标准。
2. 动态验证功能使用 `found-analysis/test-assets` 同类 fixture 走通，并附 RefCanvas 验收截图或自动化结果。
3. 界面保留三栏结构、主要信息层级、控制可达性与快捷键语义，但使用 RefCanvas 自有品牌、配色、组件和文案。
4. 部分验证、登录、Pro 和云端功能不得标为 Found 端到端对等；ComfyUI 与 Remote REST 明确标为 RefCanvas 扩展。
5. 最终追踪矩阵没有 `unmapped`、`untested` 或无证据关闭项。

<a id="goals"></a>
## 2. 目标与成功定义

### 2.1 目标

1. 用户可以在一个三栏浏览工作区中，通过多标签浏览本地目录和引用集合，并在不同标签间保留导航状态。
2. 用户可以创建零拷贝引用集合；磁盘、挂载点或文件状态变化不会静默删除集合意图。
3. 用户可以在右栏、Space 快速预览、Enter 沉浸预览和独立浮动窗口中使用一致的媒体预览能力。
4. 用户可以完成图片审阅、视频/GIF/序列帧检查、文件转换和归档工作流。
5. 用户可以通过相同 AI 面板使用 Mock、ComfyUI 或 Remote REST Provider，看到统一的进度、失败、取消、重试和输出结果。
6. 现有 Board、磁盘浏览、搜索、格式 Provider 和媒体能力保持兼容。

### 2.2 发布成功标准

- `pnpm check`、`pnpm test:performance`、`pnpm test:capacity`、`pnpm package` 和 `pnpm test:runtime` 全部通过。
- schema 13、15、16 的测试数据库均可事务性升级到 17；有可恢复集合数据时不得丢失。
- 目录与集合标签在应用重启后恢复路径、历史、查询、过滤、展平模式和滚动位置。
- 所有新增异步任务都能取消，且切换标签或关闭窗口后不会把过期结果写回当前 UI。
- AI 的 Mock、ComfyUI stub 和 Remote REST stub 均有完整的成功、失败、取消和恢复测试。
- 在 1920×1080、1366×768 和产品定义的最小窄窗口下，无阻断操作的遮挡或不可达控件。

<a id="non-goals"></a>
## 3. 明确不做

- 不使用 Found 名称、图标、视觉资源、反编译代码、私有 API 或云端协议。
- 不实现账户、登录、订阅、支付、团队分享、在线图库、浏览器扩展或 Found 云服务兼容。
- 不实现 Remote REST 服务端；只交付协议、客户端、Mock/stub 测试和配置界面。
- 不捆绑 ComfyUI、模型或工作流；用户负责安装并启动本地服务。
- 不把集合内容复制进 RefCanvas 托管库；集合始终是对磁盘文件的引用。
- 不移除或改名 Board，不把 Board 降级为集合或保存搜索。
- 不承诺 JXL、RAW、Alembic 或专有 DCC 文件的原生解码；这些格式必须给出明确的降级预览或“不支持”状态。

<a id="audience"></a>
## 4. 用户与核心流程

目标用户是需要在本机管理大量图片、视频、音频、3D、文档和设计参考的创作者。

### 4.1 浏览与预览

1. 用户从快速访问、挂载点或文件夹打开目录。
2. 目录在新标签或当前标签打开；网格可搜索、按类型过滤、缩放，并可切换展平层级。
3. 选中素材后，右栏立即展示预览和元数据；Space 打开快速预览，Enter 进入沉浸预览。
4. 用户可在预览中前后切换当前结果集，退出后仍回到原选择和滚动位置。

### 4.2 引用集合

1. 用户创建集合或子集合，将文件、文件夹展开结果或当前选择拖入集合。
2. 集合只记录引用，不移动或复制源文件。
3. 源文件离线、缺失或出现多个候选时，集合保留条目并显示状态。
4. 用户可以手动重定位；也可以把可解析条目导出到普通文件夹并获得清单文件。

### 4.3 AI Design Supervisor

1. 用户把一个源图和最多六张参考图拖入 AI 面板，输入提示词并选择 Provider。
2. 用户设置“重大改动”、输出数量和输出目录后启动任务。
3. UI 显示上传、生成、下载等统一阶段，可取消或在失败后重试。
4. 成功输出只写入用户选择的目录，随后被当前目录索引发现并显示在结果画廊中。

<a id="browser-workspace"></a>
## 5. 浏览器工作区

### 5.1 产品壳层

- 顶层工作区保留 `Browser` 与 `Board` 两种模式；切换模式不销毁另一模式的内存状态。
- Browser 默认三栏：左侧导航、中间标签与素材网格、右侧 Preview/AI。面板尺寸可调整并持久化。
- 左栏顺序固定为快速访问、挂载点、引用集合、Boards；空分组不占用大块空间。
- 中栏包含标签条、面包屑、搜索、类型筛选、展平控制、网格缩放和素材网格。
- 右栏在 `Preview` 与 `AI` 两个页签间切换；切换不终止正在运行的 AI 任务。

### 5.2 浏览标签与导航 V3

浏览标签类型：

```ts
type BrowserTabKind = "directory" | "collection";

interface BrowserTabState {
  id: string;
  kind: BrowserTabKind;
  targetId: string;            // 目录绝对路径或 collection id
  title: string;
  backStack: string[];
  forwardStack: string[];
  query: string;
  typeFilters: string[];
  flattenDepth: 0 | 1 | 2;
  gridSize: number;
  selectedKeys: string[];
  scrollOffset: number;
}

interface NavigationStateV3 {
  schemaVersion: 3;
  activeWorkspace: "browser" | "board";
  activeTabId: string | null;
  tabs: BrowserTabState[];
}
```

- 标签可新建、关闭、重排和恢复；至少保留一个空目录标签。
- 在新标签打开文件夹或集合时，不修改来源标签的历史。
- 每个标签拥有独立的目录观察、搜索请求和取消令牌；切换或关闭后丢弃旧响应。
- 应用收到第二实例传入的路径时，聚焦现有窗口：目录在新标签打开，文件在其父目录的新标签中打开并选中。
- 持久化写入沿用 Main 侧 durable navigation store；解析失败时回退到一个默认标签，不阻止启动。

### 5.3 快速访问、搜索与网格

- 快速访问支持添加、重命名显示名、重排和移除；“移除”只删除快捷方式，不操作磁盘目录。
- 面包屑每一级可导航；文件夹的上下文菜单支持在新标签打开。
- 搜索基于当前标签目标，输入变化必须取消前一个请求；搜索结果可继续使用类型筛选和展平模式。
- 展平深度为 `0/1/2`：0 只列当前目录，1 包含一层子目录，2 包含两层子目录。
- 网格缩放必须持久化到标签；序列帧可折叠为一个逻辑条目并随设置切换。
- 所有网格排序保持稳定；后台刷新不得无故改变用户选择和滚动锚点。
- 常规设置必须提供启动目录、记住上次路径、单击/双击打开文件夹、显示隐藏/点/系统文件和 UI 缩放。
- 类型筛选支持名称、扩展名、排序、新增、编辑、禁用和删除；内置类型可禁用但不可丢失默认定义。
- 序列识别支持标准、兼容和自定义正则三种模式；无效正则在保存前阻止，并显示可定位错误。
- 每目录展平规则优先于全局默认；清除目录规则后立即回退全局值。

<a id="reference-collections"></a>
## 6. 引用集合与 schema 17

### 6.1 数据模型

schema 17 新增以下持久化实体：

```ts
type CollectionItemState = "resolved" | "offline" | "missing" | "ambiguous";

interface ReferenceCollection {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface ReferenceCollectionItem {
  id: string;
  collectionId: string;
  identityId: string | null;
  mountId: string | null;
  relativePath: string | null;
  lastResolvedPath: string;
  pathKey: string;
  fingerprint: string | null;
  state: CollectionItemState;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

SQLite 表：

- `collections`：自引用 `parent_id`，删除父集合时默认拒绝；只有显式递归删除才删除子集合与条目。
- `collection_items`：仅对 `collection_id` 使用级联删除，不得以 `assets.id` 外键作为条目存活条件。
- `ai_jobs`：定义见 [AI 任务持久化](#ai-job-persistence)。
- 同一集合中相同规范化 `path_key` 只保留一个条目；重复添加返回原条目，不产生错误。

### 6.2 引用解析

解析顺序固定如下：

1. `identityId` 仍存在且指向可访问文件时，状态为 `resolved`。
2. 挂载在线且 `mountId + relativePath` 存在时，校验指纹后解析并刷新绝对路径。
3. `lastResolvedPath` 存在且指纹匹配时，恢复为 `resolved`。
4. 在同一挂载的已索引文件中按指纹查找：唯一候选自动重定位；多个候选标记 `ambiguous`；无候选标记 `missing`。
5. 挂载本身不可用时标记 `offline`，不得降级为 `missing`。

自动解析不得遍历整个未索引磁盘。手动重定位必须验证目标是文件；指纹不一致时要求用户明确确认，确认后更新身份、挂载、路径和指纹。

### 6.3 集合行为

- 支持创建、重命名、嵌套、重排、显式递归删除、拖放添加、批量添加、批量移除和在新标签打开。
- 集合网格显示在线、离线、缺失和歧义状态；不可解析项仍可查看最后路径和执行重定位/移除。
- 导出时只复制 `resolved` 条目，不移动源文件；重名默认生成 `name (2).ext`，不得覆盖目标文件。
- 导出目录包含 `.refcanvas-collection.json`，记录集合层级、原引用、导出相对路径、跳过原因和导出时间。
- 导出完成后显示已复制、已跳过和失败数量；部分失败不回滚已成功复制的文件。

### 6.4 v16 到 v17 兼容

- 修改尚未执行的 v16 步骤：发现旧集合表有数据时，将其重命名为归档表而不是删除；空表可以直接退休。
- v17 优先从归档表导入，再从迁移前备份快照导入；导入在一个事务中完成并校验集合数、条目数和非空路径数。
- 任一可见非零计数无法验证时，事务回滚、`user_version` 保持原值并返回可诊断错误。
- 对已经由旧构建执行过破坏性 v16 且没有归档表的数据库，v17 创建空集合表并保留最近迁移备份；UI 必须显示一次性恢复说明，不得声称已恢复不存在的数据。
- v17 可重复运行；成功后清理只允许发生在校验通过的归档表，迁移备份仍遵循现有备份保留策略。

<a id="preview-system"></a>
## 7. 统一预览系统

### 7.1 PreviewHost

一个 `PreviewHost` 负责选择媒体 Provider，并被以下四种容器复用：

- 右侧 Preview 面板。
- Space 快速预览覆盖层。
- Enter 沉浸预览。
- 独立浮动预览窗口。

四种容器共享媒体状态模型，但各自维护视口尺寸。切换容器不得重新启动同一个视频、音频或序列任务；关闭最后一个容器后释放对象 URL、worker 和解码资源。

键盘行为：

- `Space`：打开或关闭快速预览；输入框聚焦时不拦截。
- `Enter`：进入沉浸预览；输入框或可编辑控件聚焦时不拦截。
- `Escape`：先退出沉浸/覆盖层，再关闭浮层菜单，不改变选中项。
- `ArrowUp/ArrowDown`：在当前过滤结果集中切换上一项/下一项。

### 7.2 图片审阅

- 普通图片支持缩放、平移、适配、100%、旋转、棋盘透明背景和像素取色。
- 支持图层的格式显示图层列表和可见性；不支持图层的格式不显示空图层面板。
- 活动 LUT、曝光和显示变换仅影响预览代理，不修改源文件。
- 取色器显示屏幕像素的 RGB/HEX；从图像生成五色主色板，可复制单色值。
- 备注作为 RefCanvas 元数据保存，不写回源文件；在所有 PreviewHost 容器中同步。

### 7.3 视频、GIF 与序列帧

- 使用自定义控制条提供播放/暂停、时间线、当前时间/总时长、循环、静音、音量、播放速率和全屏。
- 视频与序列支持精确逐帧；无可靠 FPS 时使用媒体探测值，仍不可用时默认 24 FPS 并标明估算。
- 序列帧支持 FPS、起止范围、循环、当前帧和 MP4/GIF 导出。
- 支持视频帧快照到用户选择目录、视频转 GIF、视频转 PNG 序列；输出不覆盖已有文件。
- 活动 LUT 视频通过缓存代理播放；缓存键包含源指纹、LUT 指纹和转码参数。

### 7.4 已有格式接入与降级

- 保留并接入现有 3D、HDR/EXR、音频波形、文本、字体和 DCC 降级预览；PDF 必须升级为可滚动的应用内阅读视图，而不是仅显示格式卡片。
- 3D 保留相机预设、实体/线框、UV 和全屏；HDR/EXR 保留图层、通道、曝光和 tone mapping。
- 音频视图展示波形、Name、Format、Length、Author 等可获得元数据，并提供播放、定位、音量和静音。
- PDF 支持应用内滚动、缩放和页码状态；解析失败时才使用明确降级卡片。
- 不支持的格式展示扩展名、大小、路径、可用系统操作和明确原因，不显示空白画布或永久加载状态。

### 7.5 预览与色彩设置

- 设置可以独立控制视频、序列和 3D 自动播放，以及右栏 Preview/AI 页签是否显示。
- FPS 预设支持新增、排序和自定义 `0.01–240`；无效值保存前阻止。
- 序列转 MP4 设置包含 H.264/H.265、质量和 original/half/quarter 尺寸。
- 透明背景提供白/黑默认值；色彩管理提供环境变量、内置和自定义 OCIO 配置，以及 Camera Log/Look LUT 选择。
- 图片降采样设置提供备份原件、文件名后缀和输出子目录；任何批量写入前必须展示解析后的目标示例。

<a id="file-actions"></a>
## 8. 文件操作与任务中心

- 统一上下文菜单提供刷新、剪切、复制、复制路径、重命名、加入集合、ZIP 归档、已有转换动作、视频转 GIF、视频转 PNG 序列、AI Design Supervisor、在文件管理器中显示和移入回收站。
- 重命名校验空名称、保留名、路径分隔符和同名冲突；成功后集合引用及当前选择同步更新。
- 剪切/复制使用系统剪贴板兼容的文件列表格式；复制路径写入纯文本绝对路径，多选时每行一个路径。
- ZIP 归档保留目录相对结构，跳过符号链接环，默认输出到用户选择位置并使用冲突重命名。
- 永久删除默认隐藏；用户在设置中显式启用后，每次执行仍需输入目标名称确认。
- 长任务统一进入任务中心，状态为 `queued/running/completed/failed/cancelled`；任务显示进度、当前阶段、输出位置、取消和重试。
- 任务中心关闭只隐藏 UI，不取消任务；应用退出时取消不可恢复任务并清理本次临时目录。
- 自定义命令支持启停、增加、编辑、删除、排序和脚本目录；脚本由 Main 使用参数数组执行，禁止 Renderer 拼接 shell 字符串。

<a id="ai-design-supervisor"></a>
## 9. AI Design Supervisor

### 9.1 公共类型

```ts
type AiProviderKind = "remote-rest" | "comfyui" | "mock";

type AiJobState =
  | "queued"
  | "uploading"
  | "generating"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

interface AiDesignRequest {
  sourcePath: string;
  referencePaths: string[];   // 0..6
  prompt: string;
  majorChange: boolean;
  outputCount: number;        // 1..4，默认 2
  outputDirectory: string;
}

interface AiJobSnapshot {
  id: string;
  provider: AiProviderKind;
  state: AiJobState;
  stage: string;
  progress: number | null;    // 0..1；未知时为 null
  outputs: string[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Preload 暴露的最小接口：

```ts
interface CollectionsApi {
  list(): Promise<ReferenceCollection[]>;
  create(input: { parentId?: string | null; name: string }): Promise<ReferenceCollection>;
  update(id: string, patch: { name?: string; parentId?: string | null; sortOrder?: number }): Promise<ReferenceCollection>;
  delete(id: string, options: { recursive: boolean }): Promise<void>;
  listItems(collectionId: string): Promise<ReferenceCollectionItem[]>;
  addPaths(collectionId: string, paths: string[]): Promise<ReferenceCollectionItem[]>;
  removeItems(collectionId: string, itemIds: string[]): Promise<void>;
  resolve(collectionId: string): Promise<ReferenceCollectionItem[]>;
  relink(itemId: string, path: string, confirmFingerprintChange: boolean): Promise<ReferenceCollectionItem>;
  export(collectionId: string, targetDirectory: string): Promise<TaskSnapshot>;
  onChanged(callback: () => void): () => void;
}

interface AiApi {
  providers: {
    list(): Promise<AiProviderSummary[]>;
    health(kind: AiProviderKind): Promise<AiProviderHealth>;
  };
  jobs: {
    start(provider: AiProviderKind, request: AiDesignRequest): Promise<AiJobSnapshot>;
    get(id: string): Promise<AiJobSnapshot | null>;
    list(): Promise<AiJobSnapshot[]>;
    cancel(id: string): Promise<AiJobSnapshot>;
    retry(id: string): Promise<AiJobSnapshot>;
    onProgress(callback: (job: AiJobSnapshot) => void): () => void;
  };
  settings: {
    read(): Promise<AiSettings>;
    update(patch: Partial<AiSettings>): Promise<AiSettings>;
    saveSecret(provider: "remote-rest", secret: string): Promise<void>;
    inspectWorkflow(path: string): Promise<ComfyWorkflowInspection>;
  };
}
```

所有 IPC 输入先经共享 Zod schema 校验；Renderer 不接收密钥，也不能发起 Provider 网络请求。

### 9.2 AI 面板行为

- 源图必填，参考图最多六张；支持文件拖放和剪贴板粘贴。
- 提示词去除首尾空白后必须非空；输出目录必填且必须可写。
- 输出数量范围 1–4，默认 2；“重大改动”是布尔开关，由 Provider 映射为自身强度参数。
- 输入统一验证为受支持的静态图片；需要时通过 Sharp 生成临时 PNG，不修改源文件。
- 单个输入最大 100 MiB、全部输入合计最大 500 MiB；超限在任务创建前失败。
- 成功输出写入用户选择目录并触发目录刷新；重名使用编号，不覆盖现有文件。
- 任务可在应用重启后查看；只有 Provider 支持恢复时才继续轮询，否则标记为带原因的 `failed` 并允许重试。

<a id="ai-job-persistence"></a>
### 9.3 AI 任务持久化

`ai_jobs` 保存任务 id、Provider、外部任务 id、状态、阶段、进度、经过脱敏的请求 JSON、输出目录、输出路径、错误码、错误信息和时间戳。不得保存 Bearer token、预签名 URL、ComfyUI 完整上传响应或图片二进制。

状态只允许以下迁移：

- `queued → uploading | generating | cancelled | failed`
- `uploading → generating | cancelled | failed`
- `generating → downloading | completed | cancelled | failed`
- `downloading → completed | cancelled | failed`
- `failed → queued` 仅通过 retry 创建新尝试；旧记录保留。
- `completed/cancelled` 为终态。

### 9.4 Mock Provider

- 仅在开发、单元测试和显式测试构建中注册；正式打包版本不可选择。
- 使用 Sharp 根据输入指纹、提示词和序号生成确定性图片变体，模拟阶段进度并支持取消。
- 相同输入与配置产生相同像素输出，便于 UI 和端到端测试。

<a id="comfyui-provider"></a>
### 9.5 ComfyUI Provider

- 默认地址 `http://127.0.0.1:8188`，只允许 `localhost`、`127.0.0.0/8` 和 `::1`；不自动扫描局域网。
- 用户导入 ComfyUI API-format workflow JSON，并配置源图、参考图、提示词、重大改动、批量数、seed 和输出节点绑定。
- 必须检查绑定节点及 input 存在；缺失时在启动前返回字段级错误。
- 使用 `/system_stats` 健康检查、`/upload/image` 上传、`/prompt` 入队、`/ws` 接收状态、`/history/{prompt_id}` 恢复结果、`/view` 下载输出。
- WebSocket 断开后每 2 秒轮询 history；重连后停止轮询。默认任务超时 30 分钟。
- 队列任务通过 `/queue` 取消；只有当前执行任务的 `prompt_id` 属于 RefCanvas 时才调用 `/interrupt`。
- 下载的每个输出最大 250 MiB；响应 MIME 与实际图片解码均必须通过验证。

<a id="remote-rest-provider"></a>
### 9.6 Remote REST Provider v1

协议端点：

1. `POST /v1/uploads/prepare`：为每个输入取得上传 id、预签名 URL、所需 headers 和过期时间。
2. 客户端直接上传到预签名 URL。
3. `POST /v1/design-jobs`：提交上传 id、提示词、重大改动、输出数量和 `clientRequestId`。
4. `GET /v1/design-jobs/{id}`：读取状态、进度、错误和输出下载描述。
5. `POST /v1/design-jobs/{id}/cancel`：请求取消。

约束：

- Job API base URL 必须是 HTTPS、不得包含凭据，并拒绝 loopback、link-local、私有网段和解析到这些地址的主机。
- Bearer token 由 Electron `safeStorage` 加密后保存；Renderer 只能读取“已配置”状态。
- `clientRequestId` 是每次 start/retry 唯一 UUID，用于服务端幂等；网络超时重试提交时保持不变。
- Job API 禁止重定向。预签名上传/下载最多允许一次保持 HTTPS 的重定向，并对目标重新执行公网地址校验。
- 向预签名 URL 请求时不得转发 Bearer token，只发送 prepare 响应明确列出的上传 headers。
- 轮询退避为 1、2、4、8 秒，之后固定 10 秒；接收 `Retry-After` 时使用两者较大值，默认总超时 30 分钟。
- 单个下载最大 250 MiB、全部输出最大 1 GiB；文件写入临时路径，图片解码验证通过后再原子移动到输出目录。

<a id="security"></a>
## 10. 安全、错误与恢复

- Main 进程负责路径规范化、授权、网络访问、密钥、文件写入和进程调用；Renderer 只能通过最小化 Preload API 操作。
- 所有用户选择目录和 Provider 输出路径都要防止路径穿越，并验证最终路径仍位于所选输出目录内。
- 不跟随集合导出或 ZIP 中的符号链接目录；单个符号链接文件以跳过并记录处理。
- FFmpeg、Sharp、worker 和网络错误统一转换为稳定错误码与可读信息，日志中删除 token、预签名查询参数和提示词中的路径信息。
- 临时目录按任务隔离并在成功、失败、取消和应用下次启动清理；不得删除不属于当前任务前缀的目录。
- 文件监听、搜索、预览和 AI 事件都携带请求或标签 id；过期事件不得更新当前视图。

<a id="localization-polish"></a>
## 11. 设置、本地化与交互质量

### 11.1 设置覆盖

- General：启动目录、记住路径、关闭到托盘/直接退出、单击/双击打开文件夹、隐藏/点/系统文件、系统代理、详细日志、UI 缩放和 Preview/AI 页签显隐。
- Formats：扩展名分组、内置与自定义类型筛选、序列识别模式和自定义正则。
- Pro：视频/序列/3D 自动播放、每目录展平规则、FPS 预设、序列 MP4 预设和图片降采样命名。
- Color：透明背景、OCIO 来源、Camera Log 与 Look LUT；配置无效时保留上一次有效设置。
- Commands：内置命令启停、自定义命令和脚本目录的增加、编辑、排序、刷新与删除。
- 设置写入采用版本化 schema；损坏或未知字段回退默认值并保留可诊断日志，不阻止应用启动。

### 11.2 本地化与交互细节

- 引入内部 i18n 消息系统，首发 `zh-CN`、`zh-TW`、`en`、`ja`、`ko`、`es`、`fr`；缺少消息回退到英文并在开发环境报告 key。
- 新增 UI 从首次实现开始使用消息 key，不得把硬编码中文留到最终 ticket 批量替换。
- 可点击图标的命中区域不小于 40×40 CSS px；仅图标按钮提供可访问名称和悬停/键盘焦点提示。
- 按下态采用约 `0.96` 的短促缩放；避免 `transition: all`，动画遵守 reduced-motion。
- 时间码、文件大小、帧号和进度数字使用 tabular numerals。
- 图片预览边缘根据背景使用纯黑或纯白细描边，避免半透明边界污染颜色判断。
- 面板、菜单、对话框必须支持键盘导航、可见焦点和正确的 ARIA 名称。

<a id="traceability-matrix"></a>
### 11.3 Found 分析证据追踪矩阵

下表是发布时必须闭合的最低追踪矩阵；详细逐项状态以 [FUNCTION_MATRIX.md](../../gpt-5.6-instruct/found-analysis/FUNCTION_MATRIX.md) 为准。

| 能力 | Found 直接证据 | Ticket | 复刻声明 |
| --- | --- | --- | --- |
| 主窗口三栏、目录导航 | [02-main-window.png](../../gpt-5.6-instruct/found-analysis/artifacts/02-main-window.png)、[02-ui-tree.json](../../gpt-5.6-instruct/found-analysis/artifacts/02-ui-tree.json) | FND-002 | 行为与信息结构对等 |
| 单实例、多标签、路径打开 | [REPORT §4](../../gpt-5.6-instruct/found-analysis/REPORT.md)、功能矩阵“启动、窗口与导航” | FND-002 | 行为对等 |
| 快速访问与文件夹菜单 | [12-quick-access-context-menu.png](../../gpt-5.6-instruct/found-analysis/artifacts/12-quick-access-context-menu.png)、[12-folder-context-menu.png](../../gpt-5.6-instruct/found-analysis/artifacts/12-folder-context-menu.png) | FND-002、FND-007 | 入口与安全语义对等 |
| 文件监听、搜索、类型筛选 | [07-live-file-watcher.png](../../gpt-5.6-instruct/found-analysis/artifacts/07-live-file-watcher.png)、[16-video-type-filter.png](../../gpt-5.6-instruct/found-analysis/artifacts/16-video-type-filter.png) | FND-002 | 监听/筛选行为对等；搜索按规格补全 |
| 序列识别与聚合 | [08-sequence-preview.png](../../gpt-5.6-instruct/found-analysis/artifacts/08-sequence-preview.png)、[test-assets](../../gpt-5.6-instruct/found-analysis/test-assets) | FND-002、FND-006 | 行为对等 |
| 图片/SVG、棋盘、Layers、色板 | [06-svg-preview.png](../../gpt-5.6-instruct/found-analysis/artifacts/06-svg-preview.png)、[06-svg-preview-tree.json](../../gpt-5.6-instruct/found-analysis/artifacts/06-svg-preview-tree.json) | FND-004、FND-005 | 本地审阅行为对等 |
| 视频、GIF、序列时间线 | [08-video-preview.png](../../gpt-5.6-instruct/found-analysis/artifacts/08-video-preview.png)、[08-gif-preview.png](../../gpt-5.6-instruct/found-analysis/artifacts/08-gif-preview.png)、[08-sequence-preview.png](../../gpt-5.6-instruct/found-analysis/artifacts/08-sequence-preview.png) | FND-004、FND-006 | 行为对等 |
| 音频、PDF、3D | [08-audio-preview.png](../../gpt-5.6-instruct/found-analysis/artifacts/08-audio-preview.png)、[08-pdf-preview.png](../../gpt-5.6-instruct/found-analysis/artifacts/08-pdf-preview.png)、[08-3d-preview.png](../../gpt-5.6-instruct/found-analysis/artifacts/08-3d-preview.png) | FND-004 | 行为对等，内部 Provider 独立实现 |
| 沉浸与浮动预览 | 功能矩阵“预览器”、[13-after-fullscreen-exit.png](../../gpt-5.6-instruct/found-analysis/artifacts/13-after-fullscreen-exit.png) | FND-004 | 快捷键与状态连续性对等 |
| 文件/视频上下文菜单 | [09-asset-context-menu.png](../../gpt-5.6-instruct/found-analysis/artifacts/09-asset-context-menu.png)、[17-video-context-menu.png](../../gpt-5.6-instruct/found-analysis/artifacts/17-video-context-menu.png) | FND-006、FND-007 | 已验证入口对等；本地执行由 RefCanvas 实现 |
| 引用集合完整流程 | [13-collection-created.png](../../gpt-5.6-instruct/found-analysis/artifacts/13-collection-created.png)、[13-asset-added-to-collection.png](../../gpt-5.6-instruct/found-analysis/artifacts/13-asset-added-to-collection.png)、[19-delete-collection-confirm.png](../../gpt-5.6-instruct/found-analysis/artifacts/19-delete-collection-confirm.png) | FND-003 | 行为对等并增强离线恢复 |
| 设置五个区域 | [10-settings-general.png](../../gpt-5.6-instruct/found-analysis/artifacts/10-settings-general.png)、[10-settings-formats.png](../../gpt-5.6-instruct/found-analysis/artifacts/10-settings-formats.png)、[10-settings-options.png](../../gpt-5.6-instruct/found-analysis/artifacts/10-settings-options.png)、[10-settings-color.png](../../gpt-5.6-instruct/found-analysis/artifacts/10-settings-color.png)、[10-settings-commands.png](../../gpt-5.6-instruct/found-analysis/artifacts/10-settings-commands.png) | FND-002、FND-005、FND-006、FND-007、FND-011 | 参数能力对等，视觉保持 RefCanvas |
| AI Design Supervisor 输入页 | [15-ai-design-refiner.png](../../gpt-5.6-instruct/found-analysis/artifacts/15-ai-design-refiner.png)、[15-ai-design-refiner-with-input.png](../../gpt-5.6-instruct/found-analysis/artifacts/15-ai-design-refiner-with-input.png) | FND-008 | 输入流程对等 |
| ComfyUI 本地生成 | 无 Found 对应动态证据 | FND-009 | RefCanvas 扩展，不宣称 Found 对等 |
| Remote REST v1 | Found 云端只有入口/静态确认 | FND-010 | RefCanvas 自有协议，不兼容 Aalab API |
| 退出、清理、无残留 | [VERIFICATION.md](../../gpt-5.6-instruct/found-analysis/VERIFICATION.md)、[20-exit-sequence-result.png](../../gpt-5.6-instruct/found-analysis/artifacts/20-exit-sequence-result.png) | FND-011 | 结果对等 |
| 登录、账户、分享、订阅 | [11-account-menu.png](../../gpt-5.6-instruct/found-analysis/artifacts/11-account-menu.png)、[18-collection-share-options.png](../../gpt-5.6-instruct/found-analysis/artifacts/18-collection-share-options.png) | 不实施 | 明确排除，不得伪报覆盖 |

<a id="testing"></a>
## 12. 测试与验收矩阵

### 12.1 自动化

- 基线：修复 MP4 临时目录测试的全局污染，并为首次 Sharp/HEIC 加载提供定向超时或预热；不得通过跳过测试解决。
- 迁移：覆盖 schema 13、15、16 到 17，非零集合、空集合、归档导入、快照导入、校验失败回滚和重复执行。
- 集合：覆盖重复添加、四种状态、唯一/歧义指纹、手动重定位、离线挂载、递归删除确认和冲突导出。
- 标签：覆盖独立历史、状态持久化、第二实例路径、关闭标签取消搜索以及过期响应丢弃。
- 预览：用现有媒体 fixtures 覆盖每种 Provider、键盘行为、资源释放、逐帧、LUT 缓存键和导出失败清理。
- AI：用 HTTP/WebSocket stub 覆盖 Mock、ComfyUI 和 Remote REST 的成功、取消、超时、断线恢复、限流、错误响应和输出验证。
- 安全：覆盖 SSRF、DNS 解析到私网、重定向、密钥不可见、路径穿越、超限文件和错误日志脱敏。
- UI：覆盖 40×40 命中区、焦点、reduced-motion、tabular numerals、黑白图片描边和七语言回退。
- 证据追踪：CI 检查追踪矩阵中所有实施项都有有效 Ticket、自动化命令和完成标准；排除项必须保持“明确排除”。
- 分析 fixture：复制或生成与 `found-analysis/test-assets` 内容等价的测试输入；测试不得依赖 Found 安装目录、数据库、缓存或正在运行的进程。

### 12.2 人工验收

- 在 1920×1080、1366×768 和最小窄窗口分别完成目录浏览、集合导出、沉浸预览和 AI Mock 流程。
- 拔掉可移动挂载后打开集合，确认条目标为 offline；重新挂载后可恢复 resolved。
- 启动本机 ComfyUI stub/实例完成一次任务，断开 WebSocket 后确认轮询恢复且输出可索引。
- 用 HTTPS Remote REST stub 验证上传、生成、下载、取消和重试；用私网 URL 验证启动前被拒绝。
- 打包 Windows 应用，确认单实例、新标签、文件关联、浮动预览和运行时资源可用。
- 逐项回放追踪矩阵：在 RefCanvas 中使用对应测试素材生成验收截图，并检查控件存在、状态转换、快捷键与输出；不做 Found 品牌像素差分。
- 人工验收记录必须写明 Found 证据文件、RefCanvas 构建版本、测试步骤、结果和 RefCanvas 截图路径。

<a id="release"></a>
## 13. 发布与兼容默认值

- 发布版本固定为 `0.38.0`，数据库 schema 固定为 `17`。
- 保留 RefCanvas Board、现有设置和原有目录浏览行为；Navigation V2 自动迁移为一个 V3 directory tab。
- ComfyUI 默认只连接本机 `8188`，用户自行提供模型和 API-format workflow。
- Remote REST 后端未来必须遵循本规格 v1 协议；本仓库不提供部署物。
- Remote REST v1 是 RefCanvas 自有协议，不得调用或兼容报告中出现的 Aalab 私有云端地址、路由或 token。
- AI 输出只写入用户明确选择的目录，不覆盖文件，也不自动复制到托管素材库。
- 无法原生预览的 JXL、RAW、Alembic 和专有 DCC 文件使用明确降级卡片，不阻断目录浏览。
