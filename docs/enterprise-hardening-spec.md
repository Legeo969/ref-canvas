# 企业级强化改造规格（单机专业版）

> **状态**: Draft
> **范围**: 单机专业版强化（非团队共享、非多端同步）
> **架构结论**: 维持 Electron + React + SQLite 三库架构，不更换。本规格列出达成企业级所需补齐的缺口。
> **审计基线**: commit `e2b10c9`

## 1. 背景与结论

经逐项代码审计，当前架构选型（Electron + React + 三个 SQLite 库）在单机专业版目标下成立，**不需要更换架构**。已有几项做对了：

- WAL 已开启（`database.ts:219`），外键已启用（`:220`）
- 迁移是单步事务、可恢复、崩溃不留半残库（`migration-repository.ts:739-743`）
- 批量入库按 256 一批提交，崩溃最多丢一批（`library-service.ts:795-821`）
- 目录列表是分页 + 索引的（`directory-index.ts:451`，`directory_entries_name` 索引）

但"架构没问题"不等于"现状能上企业级"。下列缺口没有一条因架构选型而起，全是功能完整性问题，且均可增量补齐，不触碰渲染架构，互相基本独立。

## 2. 缺口清单（按优先级）

### P0 · 必须补（不补会出生产事故）

| # | 缺口 | 现状证据 | 后果 |
|---|------|---------|------|
| 1 | 损坏无恢复路径 | `database.ts:208-222` 启动只设 pragma + 跑迁移，不跑 `integrity_check` | SQLite 文件损坏时应用直接打不开，用户无自救手段 |
| 2 | 跨机器不可迁移 | 资产存绝对路径 `path`（`database.ts:299`）；备份只备 DB 不带缩略图（`backup-service.ts:39-53`）；恢复后缩略图与 DB 脱节 | 企业用户换机器/重装系统后库不可用 |
| 3 | 目录扫描崩溃后从头重来 | 扫描 `state='scanning'` 持久化了，但恢复时遇此状态 `DELETE` 已扫条目重扫（`directory-index.ts:684`）；`revision` 只用于缓存校验，未用于断点续传 | 50 万文件扫到一半崩溃，下次从头来 |

### P1 · 应该补（规模上来会退化）

| # | 缺口 | 现状证据 | 后果 |
|---|------|---------|------|
| 4 | 无界内存加载 | `listActiveAssets` 全表 `SELECT *` 并 hydrate（`database.ts:1777`）；`resolveSelection` 全量加载 ID 进内存（`assets-repository.ts:484`，"全选→操作"会 materialize 几十万 UUID）；`listVisualSignatures` 全量加载做查重 | 几十万文件时吃光内存或卡 UI |
| 5 | 缓存上限只在启动时执行一次 | `prune` 是 O(n) 扫所有 success 行，仅 `main/index.ts:1476` 启动时调用一次，无定时器 | 长会话期间缩略图缓存可超 2GB 上限，直到下次启动 |
| 6 | 缩略图写盘不 fsync | 用了 tmp+rename（原子），但全文无 `fsync`/`fdatasync`/`fsyncSync` | 断电时 rename 可能没落盘，缩略图丢失 |

### P2 · 建议补（运维与兼容）

| # | 缺口 | 现状证据 | 后果 |
|---|------|---------|------|
| 7 | 新版 DB 在旧应用上静默打开 | 迁移只跳过 `step.version <= current`（`migration-repository.ts:723`），无"DB 比应用新则拒绝打开"守卫；备份恢复有此守卫（`backup-service.ts:61`）但正常打开没有 | 用户降级版本拿到半残库，查询时才报错 |
| 8 | WAL 无主动 checkpoint | 全文无 `wal_checkpoint(TRUNCATE)`，靠 SQLite 默认 1000 页自动 checkpoint | 长期运行 WAL 文件持续增长 |

## 3. 详细规格

### SPEC-1 · 启动完整性检查与损坏恢复（P0）

**目标**: SQLite 主库或缓存库损坏时，应用不静默崩溃，给出明确状态与可操作恢复路径。

**现状**:
- `integrityCheck()` 存在（`database.ts:238-241`）但仅在 `system-ipc.ts:484` 按需调用、备份校验时调用（`backup-service.ts:58`），启动路径不调用。
- 损坏时 `new Database(filename)` / `migrate()` 抛异常，应用打不开。

**要求**:

1. **启动序列增加完整性检查**。在 `migrate()` 之前，对主库执行 `PRAGMA quick_check`（轻量，不全表扫）。两个缓存库（`preview-index.sqlite`、`directory-index.sqlite`）同理。
2. **分级恢复策略**:
   - `quick_check` 通过 → 正常启动。
   - `quick_check` 失败 → 进入**只读降级模式**：以只读方式打开（若可能），UI 顶部展示持久横幅"数据库损坏，已进入只读模式，请导出后修复"。禁用所有写操作（导入、打标签、看板编辑等），保留浏览。
   - 只读也打不开 → 进入**安全模式**：不打开该库，UI 提示"数据库损坏，请从备份恢复或重新扫描"，提供"从最近备份恢复"和"新建空库"两个入口。
3. **自动备份兜底**: 检测到损坏时，若文件可读，先复制一份到 `<userData>/corrupted-backup-<timestamp>.db`，再做任何恢复动作，防止恢复操作加重损坏。
4. **三个库分别处理**: 主库损坏影响最大，按上述策略；两个缓存库损坏可直接删除重建（缓存是可重建的派生数据），仅记日志并触发重建。

**验收**:
- 手动破坏主库文件（截断/填零）后启动，应用进入降级模式而非崩溃。
- 缓存库删除后启动，应用自动重建缓存库，浏览功能正常。
- 损坏发生时 `corrupted-backup-*.db` 存在。

**工作量估算**: 2-3 天

---

### SPEC-2 · 库可移植性与整机迁移（P0）

**目标**: 用户能将整个库（元数据 + 缩略图 + 配置）打包导出，在新机器/新路径上导入并可用。

**现状**:
- `BackupService.create`（`backup-service.ts:39-53`）只 `db.backup()` 出 SQLite 文件，不含缩略图。
- `backups:restore`（`backup-ipc.ts:23-41`）恢复 DB 后缩略图与 DB 脱节，无重映射。
- 资产 `path` 存绝对路径（`database.ts:299`），`library_relative_path` 仅 `managed` 模式有（`:380`）。
- 同机重定位可用 fingerprint 重解析（`findIdentityByFingerprint` `database.ts:1354`），但无跨机器路径重映射。
- 仅 collection 级文件导出（`collection-export-service.ts`），非整机库。

**要求**:

1. **库打包导出**: 新增 `library:export-bundle` IPC，产出单个 `.refcanvas-bundle`（zip 或 tar），包含:
   - `refcanvas.db`（主库快照，用 `db.backup()` 保证一致性）
   - `cache/thumbnails/`（缩略图目录，可按 `preview-index.sqlite` 索引只打包有效项，避免打包已被 LRU 剔除的孤儿文件）
   - `cache/preview-index.sqlite`、`cache/directory-index.sqlite`（可选，带过去可省去重建，不带也能重建）
   - `bundle.json`：bundle 格式版本、schema 版本、导出机器的 path 根信息、时间戳
2. **库导入与路径重映射**: 新增 `library:import-bundle` IPC:
   - 解包到目标机器 `<userData>`。
   - **路径重映射**: 扫描 `assets.path` 与 `directory` 相关路径，依据 `bundle.json` 中的导出根与用户指定的导入根做替换。例如导出机 `D:/Assets.library/` → 导入机 `E:/Assets.library/`。
   - 提供 UI 让用户确认/编辑根映射（驱动器号变化、用户名变化是常见场景）。
   - 重映射后重算 `path_key`（`database.ts:172-174` 规则）。
   - 缩略图随 bundle 带过来的，其文件名是内容无关的稳定 hash，无需重映射；若用户选择不带缓存，导入后按需重新生成。
3. **路径根记录**: 平时在库元数据中记录"已知的根路径集合"（watch_roots 已有），导出时写入 `bundle.json`，作为重映射的默认建议。
4. **managed 模式文件**: `managed` 存储的文件（库内托管）随 bundle 物理打包，导入时整体落盘，无需路径重映射。

**验收**:
- A 机导出 bundle，B 机导入并指定新根路径后，linked 资产能被定位（若文件确实在新路径下）；managed 资产直接可用。
- 缩略图随 bundle 带过来时，导入后浏览无重新生成延迟；不带时按需生成。

**工作量估算**: 5-7 天

---

### SPEC-3 · 目录扫描断点续传（P0）

**目标**: 大目录扫描被中断（崩溃、强退、worker 重启）后，下次从断点续扫，而非从头重来。

**现状**:
- `scans` 是内存 `Map`（`directory-index.ts:67`），worker 重启后为空。
- `list()` 对 `state='scanning'` 的目录走新扫分支：`DELETE FROM directory_entries` + 重置 `discovered=0, file_total=0`（`:684-692`）。
- `revision` 仅用于缓存校验与排序，未用于续传。
- 搜索同理：`start-search` 总先 `DELETE`（`:749`），不续传 `running` 状态的搜索。

**要求**:

1. **扫描改为增量提交**: 扫描过程中每批（如每 1000 条）`INSERT` 后即提交事务（当前已是批量插入，确认每批独立提交），使已扫条目持久化在 `directory_entries` 中。
2. **恢复时续扫而非重扫**: worker 启动时，对 `state='scanning'` 的目录:
   - 不删除已有 `directory_entries`。
   - 读取已扫到的最大 `discovery_ordinal`（或记录已扫到的最后路径）。
   - 用 `opendir` 流式扫描时，跳过已扫部分（按 `discovery_ordinal` 或已记录的游标），仅追加新增。
   - 或者更稳妥：由于 `opendir` 顺序不保证，记录"已扫路径集合"用于去重，全量重扫但跳过已存在的 `entry_path`（`INSERT OR IGNORE`）。权衡后选此方案，因为重扫的 I/O 成本低于维护精确游标的复杂度，且 `INSERT OR IGNORE` 能保证幂等。
3. **扫描完成标志原子化**: 全部扫完后，单事务内将 `state` 置 `complete`、写 `file_total`、写 `directory_mtime_ms`。崩溃若发生在此事务前，`state` 仍为 `scanning`，下次续扫；发生在此事务后，`state='complete'` 正常命中缓存。
4. **搜索续传**: 同理，`start-search` 对 `state='running'` 的搜索不 `DELETE`，改为续搜（或简单起见，重启即视为搜索失效、标记 `failed` 让用户重试——搜索成本低，可先做此简化，扫描续传优先）。
5. **stale scanning 清理**: 若某目录 `state='scanning'` 但对应目录已不存在或 mtime 变化，清理该扫描记录。

**验收**:
- 50 万文件目录扫描到 30 万时强退 worker，重启后继续扫剩余 20 万（或全量重扫但已存在的 30 万不重复插入），最终 `file_total` 正确。
- `directory_entries` 在续扫过程中始终可查（已扫部分可见）。

**工作量估算**: 3-4 天

---

### SPEC-4 · 消除无界内存加载（P1）

**目标**: 几十万文件规模下，无任何代码路径将全表或全结果集加载进内存。

**现状**:
- `listActiveAssets`（`database.ts:1777`）全表 `SELECT *` 并 hydrate，`library-service.ts:1607` 调用。
- `listAllAssetPaths`（`database.ts:896`）全量加载路径，`library-service.ts:1157`、`:1396` 调用。
- `resolveSelection`（`assets-repository.ts:484`）全量加载 ID，支撑 `batchUpdate`/`batchRename`——"全选→操作"会 materialize 几十万 UUID。
- `listVisualSignatures`（`database.ts:957`）全量加载签名做查重。
- `listAssetIdentityStatus`（`database.ts:1394`）全量。

**要求**:

逐项改造，原则是**流式/分批/惰性**，不一次性 materialize:

1. **`listActiveAssets`**: 改为游标分页迭代器或流式回调。调用方（`library-service.ts:1607`）改为分批消费。
2. **`listAllAssetPaths`**: 改为按目录分批或游标迭代。若调用方需要"是否存在某路径"的判断，改为点查（`SELECT 1 FROM assets WHERE path_key=? LIMIT 1`）而非加载全集。
3. **`resolveSelection`（全选）**: "全选"语义改为"选中当前查询的全部"，不 materialize ID 列表，而是**记录查询条件**，后续批量操作按条件分批 `UPDATE ... WHERE <条件> LIMIT 256` 循环至无匹配。`batchRename` 等需要逐条处理的，分批拉取处理。
4. **`listVisualSignatures`**: 查重改为分块比对（分页加载签名块，块内+跨块去重），或限制查重范围（仅当前目录/选中集），不做全库全量。
5. **审计其他 `SELECT *` 无 LIMIT 的调用点**: grep `from .*select|findAll|listAll|listActive` 确认无遗漏。

**验收**:
- 导入 50 万文件后，`listActiveAssets`/`listAllAssetPaths`/全选操作不导致内存峰值超过当前值的 1/5（量化为：JS heap 不因这些调用暴涨百 MB 级）。
- 全选 + 批量打标签在 50 万文件下可完成，不 OOM。

**工作量估算**: 4-5 天

---

### SPEC-5 · 缩略图缓存上限运行时执行（P1）

**目标**: 缩略图缓存在长会话期间不无限增长，运行时按需 prune 至上限内。

**现状**:
- `PreviewCacheIndex.prune`（`preview-cache-index.ts:103-137`）执行 TTL（30 天）+ size cap（2GB），是 O(n) 扫所有 success 行。
- 仅 `main/index.ts:1476` 启动时调用一次，无 `setInterval`/scheduler。

**要求**:

1. **触发式 prune**: 不用固定定时器（避免在忙时抢占），改为**事件触发 + 节流**:
   - 每次 `recordSuccess` 后检查累计新增字节数，自上次 prune 以来新增超过阈值（如 200MB）时触发一次 prune。
   - 节流：两次 prune 间隔不少于 N 分钟。
2. **后台执行**: prune 在 worker 或 `setImmediate` 中跑，不阻塞主线程/IPC 响应。
3. **O(n) 可接受但降频**: 全表扫 O(n) 在 2GB 级缓存下耗时可接受（百 ms 级），关键是降低执行频率（事件触发 + 节流已满足）。
4. **日志**: 每次 prune 记录前后总大小、删除条数、耗时，便于运维诊断。

**验收**:
- 持续生成缩略图超过 2GB 后，运行中触发 prune，缓存大小回落到上限内。
- prune 不导致浏览卡顿（在 idle 时段或后台执行）。

**工作量估算**: 1-2 天

---

### SPEC-6 · 缩略图写盘持久性（P1）

**目标**: 缩略图 PNG 写盘在断电/异常关机后不丢失。

**现状**:
- `ThumbnailWorkerClient` 写 `.${id}.tmp.png` 再 `rename` 到最终路径（`thumbnail-worker-client.ts:56,159`），原子性已保证（同文件系统）。
- 全文无 `fsync`/`fdatasync`/`fsyncSync`。OS page cache 未刷盘时断电，rename 可能未落盘。

**要求**:

1. **tmp 文件 fsync**: 写完 tmp 文件后、rename 前，对 tmp 文件 `fsync`（Node `fs.fsyncSync(fd)` 或用 `fs.promises.open` + `filehandle.sync()`）。
2. **父目录 fsync**: rename 后对缩略图所在目录 `fsync`（Windows 上 `fsync` 目录 fd 行为有限，可接受 best-effort；Linux/Mac 必须做）。Windows 作为优先平台，至少保证文件 fsync，目录 sync 尽力而为。
3. **批量写优化**: 不为每个缩略图单独 fsync（性能损失大），可按批攒一批后统一 fsync，或在 worker 空闲时批量刷。权衡：单文件 fsync 更安全但慢；批量 fsync 快但断电可能丢一批。推荐**单文件 fsync**——缩略图生成本身几十 ms，fsync 几 ms 可接受，且缩略图不是关键数据（丢了可重生成），此处 fsync 主要是为防止 rename 元数据丢失导致的不一致。
4. **扩展到其他关键文件写**: 导出的 collection manifest、`.before-restore` 备份等也加 fsync。DB 由 better-sqlite3 自己管持久性。

**验收**:
- 缩略图生成后，tmp 文件已 fsync 再 rename（代码审查确认）。
- 极端断电测试（如可能）后，已 rename 完成的缩略图存在。

**工作量估算**: 1 天

---

### SPEC-7 · 新版 DB 拒绝在旧应用打开（P2）

**目标**: 应用打开 schema 版本比自己新的 DB 时，明确拒绝并提示，而非静默打开后查询时才报错。

**现状**:
- 迁移跳过 `step.version <= current`（`migration-repository.ts:723`），不检查 DB 是否比应用新。
- 备份恢复有 `BACKUP_SCHEMA_TOO_NEW`（`backup-service.ts:61`），正常打开没有。

**要求**:

1. **启动版本守卫**: `migrate()` 前读 `user_version`，若 `user_version > APP_MAX_SCHEMA_VERSION`（应用已知最高迁移步骤版本），拒绝打开，抛出明确错误 `DB_SCHEMA_TOO_NEW`，UI 提示"此库由更新版本的 RefCanvas 创建，请升级应用后再打开"。
2. **不降级、不尝试**: 拒绝即拒绝，不做任何迁移或猜测，防止损坏。
3. **三个库都加**: 主库 + 两个缓存库（缓存库版本不匹配可直接删除重建，但也要先检查主库）。
4. **常量集中管理**: `APP_MAX_SCHEMA_VERSION` 从迁移步骤定义中派生，不手写，避免漏改。

**验收**:
- 用未来版本创建的 DB（手动调高 `user_version`）在当前应用上打开，被拒绝并提示升级。

**工作量估算**: 0.5 天

---

### SPEC-8 · WAL 主动 checkpoint（P2）

**目标**: WAL 文件在长期运行中不无限增长，定期回收。

**现状**:
- 全文无 `wal_checkpoint`，靠 SQLite 默认 `wal_autocheckpoint=1000`（约 4MB）被动 checkpoint。
- 长期运行 + 大量写入（如首次导入几十万文件）时 WAL 可涨到较大。

**要求**:

1. **idle checkpoint**: 应用进入空闲（无 IPC 活动若干秒）时，对三个库执行 `PRAGMA wal_checkpoint(PASSIVE)`。PASSIVE 不阻塞，够用。
2. **退出前 TRUNCATE**: 应用正常退出前，对三个库执行 `PRAGMA wal_checkpoint(TRUNCATE)`，把 WAL 收缩到最小。
3. **不做 TRUNCATE on idle**: TRUNCATE 会阻塞读者，只在退出时做。
4. **导入完成后 checkpoint**: 大批量导入（如首次扫描入库）完成后，主动 PASSIVE checkpoint 一次，回收导入期间积累的 WAL。

**验收**:
- 长期运行（数小时、有大量扫描入库）后 WAL 文件不持续增长。
- 正常退出后 WAL 文件接近 0。

**工作量估算**: 0.5 天

## 4. 实施顺序与依赖

```
SPEC-1 (损坏恢复)      ──┐
SPEC-7 (版本守卫)      ──┼── 启动序列相关，一起做，先做
                         │
SPEC-3 (扫描续传)       ──── 独立，可并行
SPEC-6 (fsync)          ──── 独立，可并行
                         │
SPEC-4 (无界加载)        ──── 独立，但建议在大规模验证前做
SPEC-5 (缓存 prune)     ──── 独立
SPEC-8 (WAL checkpoint) ──── 独立，可并行
                         │
SPEC-2 (库可移植)        ──── 依赖 SPEC-1 的备份机制与 SPEC-4 的流式改造，靠后做
```

**建议批次**:
- **批次 A（启动安全，约 3 天）**: SPEC-1 + SPEC-7。先把"打不开/降级打开"这条命脉守住。
- **批次 B（可靠性，约 5 天）**: SPEC-3 + SPEC-6。崩溃不丢工作、断电不丢缩略图。
- **批次 C（规模，约 6 天）**: SPEC-4 + SPEC-5 + SPEC-8。大规模不退化。
- **批次 D（可移植，约 6 天）**: SPEC-2。整机迁移能力。

总计约 20 工作日。各批次内可并行，批次间有轻微依赖。

## 5. 非目标（明确不做）

- **不换架构**: 不从 Electron 迁 Qt，不从 SQLite 迁 PostgreSQL。单机专业版场景下两者均非必要，迁移成本远高于补齐缺口的收益。
- **不做团队共享/多端同步**: 本规格范围是单机专业版强化。共享库、多端同步是后续独立规格，届时再评估是否引入服务端数据库。
- **不做原生渲染层重写**: 渲染层优化（WebP 输出、键落库、网格虚拟化）属于性能优化，独立于本规格的企业级可靠性改造，另行处理。

## 6. 验收基线

补齐 SPEC-1 至 SPEC-8 后，应满足:
- 破坏主库文件 → 降级模式可浏览，不崩溃
- 缓存库删除 → 自动重建
- 50 万文件目录扫描中断 → 续扫完成
- 50 万文件全选批量操作 → 不 OOM
- 长会话缩略图缓存 → 不超 2GB
- A 机导出 → B 机导入可用（路径重映射后）
- 降级应用打开新库 → 明确拒绝
- 长期运行 → WAL 不无限增长
