# 截图恢复 QQ 语义:所见即所得 + 最小化绝不弹窗

## 用户确认的目标行为(QQ 式)

- 宿主**可见**时截图:宿主留在原地、出现在冻结画面里(不隐藏、不最小化、零闪烁)。
- 宿主**最小化/藏托盘**时按 Ctrl+Shift+R:绝不弹出,画面里自然没有它。
- 保存成功:宿主可见 → focus 主窗口展示 toast;宿主最小化 → 托盘气泡告知结果,**不弹窗**。
- 取消:宿主原样,可见则 focus 回。

## 改动(全部集中在 src/main/index.ts + 两处注释)

### 1. runRegionCapture:删除"隐藏宿主"逻辑
- 删掉 `captureHostVisibility` 记录、逐窗 `hide()`、150ms 等待 —— 直接抓屏(所见即所得)。
- 保留上一轮的全部正确修复:多屏逐屏抓取、单屏失败跳过(全失败才抛)、焦点屏退化、`capture:renderer-ready` 底图重推(修"点两次")、`captureSourcesByDisplay` 缓存。
- doc 注释改回 QQ 语义:直接抓「用户此刻看到的画面」,宿主可见就在画面里;最小化时它本就不在屏幕上,无需任何处理。

### 2. endCaptureSession:删除 show 恢复循环
- 删掉按 wasVisible 逐窗 `show()` 的恢复(不再有隐藏,无需恢复)。
- `saved`:宿主可见且非最小化 → `focus()`(toast 可见);否则 → `showTrayNotification("RefCanvas", "截图已保存并复制到剪贴板。")`,不动窗口。
- `cancelled`/`error`/`forced`:宿主可见 → `focus()`;否则什么都不做。
- 模块变量 `captureHostVisibility` 删除。

### 3. 保留不动
模态锁定(setFocusable/setMovable)、screen-saver 置顶、焦点钳制、多屏覆盖 + 跨屏互斥、热键直连不弹宿主、失败提示不弹窗(可见→主窗口 notice / 隐藏→托盘气泡)、覆盖窗 closed/display-removed/quit 兜底。

### 4. 注释同步
- `App.tsx` 两处注释删去"隐藏宿主"表述,改回所见即所得描述。

### 5. 验证
- `npm run typecheck` + `npm run lint` + 截图相关 vitest(33 个)。
- `npm run package` 重打包 `out/`(提醒用户先彻底退出旧进程再启动)。

## 验收清单(用户手动)
1. 宿主可见,点截图按钮:窗口不动、不闪,冻结画面里含宿主;Esc 取消后一切如初。
2. 最小化宿主,Ctrl+Shift+R:窗口不弹出,画面无宿主;Esc 取消后宿主保持最小化。
3. 最小化热键截图并保存:托盘气泡提示,窗口不弹出。
4. 可见状态截图并保存:主窗口回到前台弹 toast。
5. 每次点击/热键一次即进入截图(无"点两次")。