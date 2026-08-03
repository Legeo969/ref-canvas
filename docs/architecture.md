# RefCanvas 架构与质量门禁

## 当前边界

```text
renderer (React/Zustand)
  -> window.refCanvas
preload (capability bridge)
  -> typed IPC contracts
main (Electron composition root)
  -> application services
  -> database / filesystem / workers
shared (platform-independent contracts and pure logic)
```

- `src/app` 只能通过 `window.refCanvas` 使用系统能力，不得导入 Electron、Node 或 `src/main`。
- `src/preload.ts` 是 renderer 唯一 capability bridge；公开接口以 `src/shared/contracts.ts` 为准。
- `src/main` 可以依赖 `src/shared`，不得依赖 renderer 实现。
- `src/shared` 不得依赖 Electron、Node、renderer 或 main。
- IPC 注册必须通过 `src/main/secure-ipc.ts`，所有 invoke/send 都先验证 sender。
- 所有 BrowserWindow 必须复用 `src/main/window-security.ts` 的安全配置与导航策略。

这些规则由 `src/main/architecture.test.ts` 自动检查，不依赖人工 code review 记忆。

## 门禁

| 场景 | 命令 | 阻断条件 |
| --- | --- | --- |
| 日常开发 / PR | `pnpm check` | typecheck、架构边界或任一测试失败 |
| 架构快速检查 | `pnpm test:architecture` | 分层逆向依赖、IPC 绕过或窗口策略回归 |
| 发布候选 | `pnpm check:release` | 日常门禁、性能 smoke 或 Electron package 失败 |
| Windows 分发 | `pnpm make` | Squirrel/ZIP 产物失败；签名发布还必须配置证书 |

CI 应使用锁定版本的 pnpm，并在独立安装阶段执行 `pnpm install --frozen-lockfile`；检查阶段只运行上表命令，避免边检查边修改依赖树。

## 已落地的职责拆分

### Main composition root

`src/main.ts` 只保留启动、生命周期、窗口协调和依赖装配。业务 IPC 已按域迁到：

- `src/main/ipc/library-ipc.ts`
- `src/main/ipc/library-management-ipc.ts`
- `src/main/ipc/filesystem-ipc.ts`
- `src/main/ipc/board-ipc.ts`
- `src/main/ipc/action-ipc.ts`
- `src/main/ipc/backup-ipc.ts`
- `src/main/ipc/media-notes-ipc.ts`
- `src/main/ipc/system-ipc.ts`

各注册函数接收显式 dependencies，并通过 getter 获取可切换的 library/database/service 实例，避免闭包持有旧实例。`SecureIpcRegistrar` 统一处理 invoke/send sender validation。

协议和平台适配也已从入口迁出：

- `src/main/protocols.ts`：`refasset`、`refbrowse`、thumbnail/cache protocol
- `src/main/windows-integration.ts`：SendTo、registry、Squirrel integration
- `src/main/window-security.ts`：BrowserWindow security policy

### BoardCanvas view slices

命令查询、active selection、recent commands、shortcut recording 和 shortcut conflict UI 已迁到独立组件：

- `src/app/components/BoardCommandPalette.tsx`
- `src/app/components/BoardShortcutSettings.tsx`

Fabric canvas lifecycle 仍由单一 owner 管理，未改变 undo 或 pointer semantics。

### 编译与架构门禁

TypeScript 已启用 `noUnusedLocals` 和 `noUnusedParameters`。架构测试同时检查依赖方向、raw `ipcMain` 绕过、domain IPC 的 `SecureIpcRegistrar` 使用，以及 BrowserWindow 安全策略。

## 后续受控重构

### Persistence boundaries

目标：把 schema migration 与运行时查询/命令分离。此项涉及历史数据库兼容和 transaction ownership，不在本轮机械拆分。

保留 `RefCanvasDatabase` 作为 transaction owner，先迁出 migration definitions，再按 asset、board、settings 拆 repository。跨域写操作仍由 service 开 transaction，禁止 renderer 直接感知表结构。

完成标准：历史数据库迁移、备份恢复、跨表操作测试全部保留；不存在 repository 之间隐式 transaction。

### BoardCanvas behavior slices

先为 selection、viewport、drawing、history 补齐 characterization tests，再按行为抽取 controller hook。不要按任意行数拆文件，也不要同时改变 canvas lifecycle、undo 或 pointer semantics。

完成标准：手势到 command 的映射可独立测试；Canvas 生命周期仍只有一个 owner；2,000 对象性能门槛不下降。

## 暂不执行

- 不以“文件必须少于 N 行”作为门禁；它会推动机械拆分，不能证明内聚性改善。
- 不一次性替换 Zustand、Fabric.js、SQLite 或 IPC contract；当前风险主要来自职责集中，不是基础技术选型。
- 不把性能 smoke 放入每次快速检查；其耗时和环境敏感性更适合作为 release gate。
