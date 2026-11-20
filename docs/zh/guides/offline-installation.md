# DSH 插件离线安装包

离线包内置插件的 Node 运行依赖、CPython 3.12.12、PowerContext、嵌入式 seekdb 和 Trace 上报依赖。首次启用记忆直接使用包内 Python，不需要下载运行环境，也不复用机器上的 Python。

这不是 DSH 桌面程序安装包。目标机器必须已经安装 DSH、其所选 profile 的依赖以及 DSH 使用的 pnpm。模型 API 仍需要联网；AI Vision 服务端和 Electron 不在此包中。普通 npm 包继续保持原有体积与安装方式。

## 选择包

| 文件名中的平台         | 支持环境                       |
| ---------------------- | ------------------------------ |
| `win32-x64-offline`    | Windows x64 原生运行，无需 WSL |
| `darwin-arm64-offline` | Apple 芯片，macOS 15 或更高    |
| `darwin-x64-offline`   | Intel，macOS 15 或更高         |

macOS 下限来自固定版本的 pylibseekdb 原生 wheel。Windows ARM64 暂不提供。选择与 DSH 进程架构匹配的包。

## 安装

1. 从 GitHub Release 下载对应平台的 `*-offline.tgz` 和同名 `.sha256` 文件，传到目标机器。
2. 用 `Get-FileHash -Algorithm SHA256`（Windows）或 `shasum -a 256`（macOS）计算 tgz 的摘要，对照 `.sha256` 文件。
3. 退出 DSH，在下载目录运行（替换为实际文件名）：

   ```sh
   dsh plugin --profile desktop add --offline --ignore-scripts --config.auto-install-peers=false "./dsh-pet-powercontext-VERSION-plugin-PLATFORM-ARCH-offline.tgz"
   ```

   Web 宿主改用 `--profile web`。`--offline` 禁止包管理器下载，`--config.auto-install-peers=false` 避免重复安装由 DSH 宿主提供的依赖；若提示宿主依赖未准备齐，应先在联网机器准备同版本的 DSH profile，不能将去掉此参数视为离线安装成功。

4. 重启 DSH，在桌宠配置中填写聊天模型、记忆整理模型与 Embedding 接口，启用 PowerContext/seekdb。
5. AI Vision 按需填写已部署服务的地址。模型调用和 Trace 上报按配置联网。

离线包校验失败时会明确报错，不自动联网修复。升级时重新安装完整离线包，用户数据仍保留在 DSH 数据目录；不要手工替换正在使用的包内 Python。

## 构建与验收

`Offline plugin packages` 不在创建或更新 PR 时自动运行。手动触发可选择分支或 tag，只生成 Actions artifacts，不发布。正式版本在 npm 发布和 GitHub Release 创建成功后调用，三个原生平台均验收成功才上传到已有 Release；不会发布平台特定包到 npm。离线包构建失败会使整条 Release 流水线显示失败，但不会阻塞或撤回此前已完成的 npm 发布。

流水线先运行单元测试及 npm prepack 门禁，再组装原生依赖。随后分别使用空 pnpm store 和空 npm 缓存强制离线安装 tgz，将安装目录搬移至含空格的新路径，再验证插件实际运行环境选择、SQLite 扩展能力、真实 seekdb 写入/检索及 Trace 连续性，并在第二个 Python 进程中验证重启后的记忆检索。Python 集成测试拒绝非回环连接，模型使用固定向量替身，因此不证明云模型质量。包内包含 `runtime/offline/manifest.json`、Python 精确依赖版本和 Node 锁文件。

现有宿主的 DSH 插件导入及桌面 UI 仍需发布前验收：基础包的离线 npm 安装通过，不等于所有 DSH profile 都具备完整宿主依赖。此包不包含独立 `.exe`/`.dmg`，也不替代桌面签名和公证。

## 源码地图

| 文件                                       | 职责                                     |
| ------------------------------------------ | ---------------------------------------- |
| `.github/workflows/release-offline.yml`    | 三平台构建、验收、Release 附件发布       |
| `dsh-pet/scripts/build-offline.mjs`        | 构建平台专用包、内置 Python 和依赖、摘要 |
| `dsh-pet/scripts/test-offline.mjs`         | 空缓存安装、搬移和真实数据库验证         |
| `dsh-pet/src/standalone/memory-offline.ts` | 校验平台及运行环境清单                   |
