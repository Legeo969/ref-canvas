全宿主 AI 残留清理（已完成全库扫描：git grep 覆盖 src/tests/scripts/docs/样式/配置，包括大小写与中文变体）

## 一、用户可见文案（i18n，4 处改/删）

1. **任务中心副标题**（你看到的那个"AI"）
   - `src/renderer/app/i18n-catalogs/common.ts:36`（en）："Unified progress for imports, batches and AI." → "Unified progress for imports, batches and exports."
   - `common.ts:134`（zh）："导入、批处理与 AI 任务统一进度。" → "导入、批处理与导出任务统一进度。"

2. **删除死键**（全库无组件引用，已 grep 确认）
   - `common.ts:53/:151`：删 `preview.tab.ai`（"AI Design Director"/"AI 设计总监"）
   - `shell.ts:13/:103`：删 `titlebar.ai`（"AI Design"/"AI 设计"）
   - `src/renderer/app/i18n-keys.ts:1908/:2569`：同步删 `"preview.tab.ai"`、`"titlebar.ai"` 类型成员

## 二、死样式（1 处）

3. `src/renderer/styles/preview-panel.css:20-21`：删 `--preview-ai-bar`、`--preview-ai-bar-alt` 两个变量——AI 面板样式已随功能删除，这两个变量定义后全库零引用。

## 三、过时注释（产品代码 3 处 + 测试 2 处）

4. `src/renderer/app/App.tsx:312`：删"（AI Provider 面板的"去设置"按钮依赖它）"——该面板已删，设置直达机制本身保留
5. `src/renderer/components/PreviewPanel.tsx:423`："AI 入口由顶部功能图标承担"一句已失效，删除
6. `src/renderer/components/CaptureOverlay.tsx:369-371`：`refcanvas:open-ai-workbench` 事件全库已无 dispatch/listener，注释改为只陈述仍然成立的防御原因（Enter 默认激活聚焦元素会泄漏成点击）
7. `tests/unit/renderer/components/PreviewPanel.test.tsx:90`：测试标题 "with Preview and AI tabs" → "with only the Preview tab"；:111-112 注释同步精简
8. `tests/unit/renderer/components/capture-overlay.test.tsx:190`：注释不再引用已删除的事件名

## 四、有意保留（不是残留，动了会出问题）

- **数据库迁移链**（`migration-repository.ts` v17 建 ai_jobs / v21 加列 / v22 DROP，`collection-restore-migrations.ts` 的 v17 重建脚本，及对应迁移测试）：这是"AI 移除"的执行机制本身——已有用户数据库必须沿 v17→v21→v22 单调升级，v22 的 DROP TABLE 正是清表动作，删掉反而会把 ai_jobs 留在用户库里。
- **`tests/runtime/scenarios/packaged-smoke.cjs:169-174`**：打包冒烟守卫，断言 `.ai-panel`/`.ai-workbench` DOM 不存在——防止 AI 残留复活的防线，保留。
- **`src/shared/contracts.ts:504` 的 `"ai"`**：Adobe Illustrator 文件扩展名，与 AI 无关。
- **`docs/opencil/*.op`**：设计稿 mock 数据里出现的 "ComfyUI…" 等是模拟用户磁盘文件夹名的假数据，非产品功能。

## 验证

```
npx vitest run tests/unit/renderer/app/i18n.test.ts tests/unit/renderer/components/TaskCenter.test.tsx tests/unit/renderer/components/PreviewPanel.test.tsx tests/unit/renderer/components/capture-overlay.test.tsx
npx tsc --noEmit
```

完成后全库 `git grep` 复扫 `\bAI\b`，预期仅剩迁移历史与冒烟守卫两类有意保留项。