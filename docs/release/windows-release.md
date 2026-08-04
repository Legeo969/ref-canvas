# RefCanvas 发布流程（阶段 7）

## 发布前检查

```powershell
pnpm licenses              # 重新生成 THIRD_PARTY_NOTICES.md + LICENSE-MANIFEST.json
pnpm check                 # lint + typecheck + 全部单元/集成测试
pnpm check:release         # check + performance + capacity + package + runtime smoke
```

## 打包与安装器

```powershell
pnpm package               # 产出 out/RefCanvas-win32-x64
pnpm make                  # 产出 Squirrel 安装器 + zip + nupkg（out/make）
pnpm test:package          # 打包产物结构冒烟（asar/native runtimes/清单文件）
pnpm test:runtime          # 启动打包后 exe，CDP 连接做运行时冒烟
```

### 签名（Windows Code Signing）

forge.config.ts 已支持两种签名方式，**未配置时产物名带 `-unsigned` 后缀**：

| 环境变量 | 用途 |
| --- | --- |
| `REFCANVAS_CERTIFICATE_FILE` + `REFCANVAS_CERTIFICATE_PASSWORD` | PFX 证书文件签名 |
| `REFCANVAS_SIGN_WITH_PARAMS` | signtool 风格自定义参数（如证书指纹） |

签名后 Setup 名称自动变为 `RefCanvas-Setup.exe`，`app.getVersion()` 的
`installChannel` 返回 `signed`；未签名返回 `unsigned`（Settings > About 可见）。

### 更新（Updater）

更新走 **Squirrel.Windows** 内建机制，无额外服务器依赖：

- 发布新版本时重新执行 `pnpm make`，产出新 `RefCanvas-Setup.exe` 与
  `ref_canvas-<version>-full.nupkg` + `RELEASES` 文件。
- 用户运行新 Setup 即完成更新（Squirrel 自动替换旧安装、保留
  `%LOCALAPPDATA%` 数据）。
- `RELEASES` 文件列出 delta 更新项；完整分发只需 full nupkg + Setup。

> 注意：方案承诺"系统代理只用于 signed update 请求，不承载账号或素材服务"。
> 当前更新是用户手动触发 Setup 的本地安装，不发起任何网络更新请求。

## 本地崩溃转储（Local crash dump）

主进程启动时调用 `crashReporter.start({ submitURL: "", uploadToServer: false })`：

- 崩溃 dump 写入 `%APPDATA%/RefCanvas/Crashes`（userData/Crashes）。
- 不自动上传；`extra` 携带 appVersion / platform / channel 便于本地定位。
- 渲染进程崩溃由 Electron 默认处理，同样落在 Crashes 目录。

## License manifest

- `pnpm licenses` 扫描发布依赖白名单（native runtimes：better-sqlite3、
  sharp/@img、ffmpeg-static、@ffprobe-installer 及其传递依赖），生成：
  - `THIRD_PARTY_NOTICES.md`（人类可读，含 LICENSE 全文截断）
  - `LICENSE-MANIFEST.json`（机器可读，供合规审计）
- 两个文件通过 forge ignore 白名单打进 app.asar；`package-smoke` 验证其存在。
- ffmpeg/ffprobe 为 GPL-3.0 静态二进制，**仅作为外部进程调用**（不链接进
  RefCanvas 本体），已在文档中单独列节说明。

## Clean Windows VM smoke（发布验收）

在干净的 Windows 10/11 VM 上：

1. 安装 `RefCanvas-Setup.exe`（或 unsigned 版本）→ 检查开始菜单快捷方式、
   卸载入口正常。
2. 首次启动 → 创建默认资料库（`%APPDATA%/RefCanvas`）→ Settings > About
   显示 schema 版本与安装渠道。
3. 打开一个含 EXR/视频/图片序列/字体的目录 → 缩略图与预览正常生成
   （验证 ffmpeg/ffprobe/sharp unpacked 路径）。
4. 关闭窗口 → 数据完好；再次启动 → 上次目录/白板恢复。
5. 检查 `Crashes` 目录存在（即使无崩溃，crashReporter 初始化成功）。
6. 卸载 → 资料库数据是否保留由用户选择（Squirrel 卸载默认保留
   `%APPDATA%`，`--squirrel-uninstall` 只移除快捷方式与集成）。
