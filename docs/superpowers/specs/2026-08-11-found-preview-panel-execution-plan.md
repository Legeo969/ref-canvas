# Found 右侧预览面板 1:1 复刻 — 执行计划

日期：2026-08-11
规格基线：`2026-08-11-found-preview-panel-1to1-spec.md`（三重证据：QML 源码 / UI 树几何 / 像素取色）
执行原则：只读核对在先，改一个验一个；每阶段独立验收后可回滚。

## 0. 当前状态盘点（实施已暂停，工作区如实记录）

| # | 项 | 状态 |
|---|---|---|
| 1 | 规格文档 | ✅ 完成（A/B/C 三级证据、权威色板、类型差异矩阵、验收标准 §8） |
| 2 | 骨架（des-1） | ✅ 已落地并通过验证：`FoundPreviewPanel/FoundToolbar/FoundSlider/FoundEmptyState` + `found-preview.css` + i18n 5 key + App.tsx 接线 + `FoundPreviewPanel.test.tsx`（typecheck 0 错，320+ 测试通过） |
| 3 | 3D/PDF（des-5） | ⚠️ 部分落地未验证：`ModelPreview.tsx`（+7/-7）+ `ModelPreview.css`；Camera(5) 完整度未核查 |
| 4 | 图片/SVG（des-2，已取消） | ⚠️ 遗留：`FoundLayersPanel.tsx` + `found-layers.css`（新文件）+ `AssetPreview.tsx` 改动，未验证 |
| 5 | AI 面板（des-3，已取消） | ⚠️ 遗留：`AiDesignSupervisor.tsx` + `ai.css` + `index.css` 改动，未验证 |
| 6 | 工具条接线（des-4，已取消） | ⚠️ 遗留：`SequencePreview.tsx`、`VideoPreview.tsx` 改动；`GIFPreview.tsx`/`FoundToolbar` 接线未见 |
| 7 | 音频（des-6，已取消） | ❌ 未见落盘改动 |
| 8 | 环境约束 | oracle / fixer lane 不可用（多次 Session error）；designer / observer 可用 → 本计划全部使用 designer 执行 |

## 1. 目标

以规格文档为验收基线，1:1 复刻 Found 右侧预览面板：
双 Tab（预览 / AI 设计总监）+ 8 类型预览（图片 / SVG / GIF / 视频 / 音频 / 序列 / PDF / 3D）+ Found 双行工具条 + AI 四区面板 + 空态，色值像素级对齐（#242424 / #2E2E2E / #0085FF / #59D165 体系）。

## 2. 阶段划分（串行为主，并行受限）

### Phase 0 — 现状核对与基线修复（先于一切）
**目标**：把工作区恢复到"可编译、可测试"的确定状态，吸收或回滚取消遗留的改动。
- 任务 0.1：`git diff` 逐文件核对 4/5/6 项遗留改动内容与完整性
- 任务 0.2：跑 `pnpm typecheck` + `pnpm test`，定位取消遗留是否引入破坏
- 任务 0.3：决策并执行（每条改动二选一）：
  - 保留：内容完整且符合规格 → 纳入后续阶段验收
  - 回滚：内容残缺或方向偏离 → `git checkout -- <file>`（新文件 `Remove-Item`）
- 产出：基线报告（当前可编译状态 + 每文件保留/回滚结论）
- 验收：typecheck 0 错、全量测试绿、工作区 diff 与计划一致

### Phase 1 — 骨架复核（des-1 产物）
- 只做验收复核：Tab 栏（预览/AI 设计总监、激活下划线 #0085FF）、工具条静态骨架、空态、色板变量、App.tsx 接线、FoundPreviewPanel 测试
- 产出：复核清单（对照规格 §1/§2/§6）
- 验收：与规格逐项一致；有偏差则列出修正任务（不立即改）

### Phase 2 — 工具条真实接线（des-4 完成版）
**文件**：`FoundToolbar.tsx`、`FoundSlider.tsx`、`FoundPreviewPanel.tsx`（仅接线锚点）、`VideoPreview.tsx`、`SequencePreview.tsx`、`GIFPreview.tsx`
**任务**：
- 2.1 FoundToolbar props 定型：progress/duration/currentTime/frame/loop/onSeek/onToggleLoop/fps/speed/volume/muted/onVolumeChange/palette/variant
- 2.2 FoundSlider：pointer 拖动 seek、轨道/填充/手柄规格（轨道深灰、填充按 variant 蓝/绿、白手柄）
- 2.3 时间码：视频 `HH:MM:SS`、GIF `HH:MM:SS:F`、序列帧号
- 2.4 画布叠加：视频 `FRAME NNN`、序列 `SEQUENCE NNNN`（白 12-16px 无衬线，左上）
- 2.5 序列绿色进度（--found-sequence）、视频/GIF 蓝色（--found-accent）
- 2.6 色块组数据接入（palette props 到 PreviewColorBar 数据源）
**验收**：`vitest run tests/unit/renderer/components/` 全绿；typecheck；手动清单：三类播放器进度/时间码/循环/FPS 联动

### Phase 3 — 类型预览对齐（3 个子阶段，可并行，文件不重叠）
**3a 图片/SVG**（文件：`AssetPreview.tsx`、`ImagePreviewViewport.tsx`、`FoundLayersPanel.tsx`、`found-layers.css`）
- 透明素材棋盘格背景（可切换）；SVG fit 居中；SVG 顶部 `▶ Layers (N)` 折叠面板（30-36px 行；数据源暂空，props 预留）
- 验收：PNG/SVG 透明底显示棋盘格；Layers 折叠/展开交互可用

**3b 视频/GIF**（文件：`VideoPreview.tsx`、`GIFPreview.tsx`）—— 与 Phase 2 合并执行（同一文件，避免双 writer）

**3c 序列**（文件：`SequencePreview.tsx`）—— 与 Phase 2 合并执行

**3d 音频**（文件：`AudioPreview.tsx` + 新 css）
- 画布 #242424、波形 #0085FF 系、底部 `Name / Format / Length / Author` 元数据行
- 验收：波形渲染 + 元数据行 + 播放控制

**3e PDF**（文件：PDF 渲染组件 + 新 css）
- 白纸 #FFFFFF 居中 + 深色画布背景 + fit 缩放
- 验收：PDF 页面白纸样式

**3f 3D**（文件：`ModelPreview.tsx`、`ModelPreview.css`）—— 核对 des-5 遗留，补全
- 渐变视口（#1A1A2E→#16213E 区间）；`Camera (5)` 预设按钮组（Default/Top/Front/Left/Right，当前高亮）
- 验收：5 视图切换生效、默认视角不变、现有导出/截图不破坏

### Phase 4 — AI 面板四区对齐 + 空态（des-3 完成版）
**文件**：`AiDesignSupervisor.tsx`、`ai.css`、`i18n.ts`（追加 key，en/zh-CN/zh-TW）
- 空态：虚线框（#555555、圆角 8px）＋「拖放或右键粘贴原始设计」
- 四区：原图预览区（35%）/ 无边框文本域（placeholder + 拖拽抓手）/ + 附件按钮（40x40）/ 底部操作栏（toggle + 灯泡 #D4A843 + `- N 张 +` + 「专业修改」）
- 保留现有功能逻辑与 AiDesignSupervisor 测试语义
- 验收：`AiDesignSupervisor.test.tsx` 绿；布局对照规格 §5

### Phase 5 — 整合验证（最终门禁）
- 5.1 `pnpm check`（repo 卫生 + lint + typecheck + 全量测试）
- 5.2 运行应用截图（主窗口/视频/序列/音频/SVG/3D/PDF/AI 各 1 张）
- 5.3 observer 像素对照：RefCanvas 截图 vs Found 截图（08-* 系列），色值抽查 #242424/#2E2E2E/#0085FF/#59D165
- 5.4 规格 §8 验收清单逐项打勾，输出差距报告
- 5.5 未决项移交清单（见 §5）

## 3. 依赖关系图

```
Phase 0（基线修复）
   └─> Phase 1（骨架复核）
          └─> Phase 2+3b+3c（工具条与媒体接线）── 3d 音频（并行，无重叠）
          └─> 3a 图片/SVG ────────────────┐
          └─> 3e PDF ─────────────────────┤ 并行（文件不重叠）
          └─> 3f 3D（核对 des-5）──────────┤
          └─> Phase 4 AI 面板 ─────────────┘
                 └─> Phase 5 整合验证
```

## 4. 执行配置

- 执行人：designer（oracle/fixer 当前环境不可用）
- 每阶段独立任务派发，提交前 `pnpm typecheck` + 相关测试
- 每阶段完成后 git 快照（commit 或 stash），便于回滚

## 5. 风险与未决项

| 项 | 说明 | 处理 |
|---|---|---|
| ACES/LUT 色彩管线 | Found 的 LUT 按钮/ACES 显示变换需要渲染管线能力（main 进程 shader/three 扩展），超出纯 UI 范围 | 二期；本期 LUT 按钮仅 UI 占位 |
| SVG 图层数据源 | Found 的 Layers 列表来自 SVG 解析；RefCanvas 无对应解析器 | 本期折叠面板 UI 先行（Layers (0)），解析接后续 |
| C 级控件语义 | 工具条 `C` 按钮、剪刀、`>` 展开、色块点击行为为目测推断 | 运行时对照 Found 截图确认后定稿 |
| 3D Camera(5) 视角 | Found 预设视图与模型 up 轴关系需实测 | 实现时按合理近似，验收时对照 |
| 取消遗留改动 | Phase 0 前工作区含 4 个 lane 的部分写入 | Phase 0 逐文件核对，保留/回滚二选一 |

## 6. 回滚方案

- 阶段级：每阶段完成即打 git 快照；该阶段违规可 `git checkout -- <files>` + 删除新增文件
- 全量：`git stash` / 或按 Phase 0 记录的文件清单逐个回滚
- 新文件回滚：`Remove-Item <path>`（清单见各阶段产出）
