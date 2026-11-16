# 发布版本

[English](../../en/guides/releases.md) · 简体中文 · [文档首页](../README.md)

包名为 `dsh-pet-powercontext`。发布版本由标签决定：`v0.1.1` 生成版本 `0.1.1`，`v0.1.2-beta.1` 生成版本 `0.1.2-beta.1`。发布前不需要手动修改版本字段。[Release workflow](../../../.github/workflows/release.yml)仅由推送 `v*` 标签或手动操作触发。普通 PR 和分支推送不会触发打包。只有推送 `v*` 标签才进入发布。

## 发布准备

1. 将需要发布的改动合并到 `master`。
2. 需要发布 npm 时，在仓库 Actions Variables 配置 `NPM_PUBLISH=true`，Actions Secrets 配置有发布权限、适合无人值守发布的 `NPM_TOKEN`。不要把令牌提交到 `.npmrc`。没有开启变量时，只发布 GitHub Release 和桌面产物。
3. 选择未使用过的版本，从准备发布的提交推送对应标签，例如：

```sh
git switch master
git pull --ff-only origin master
git tag v0.1.1
git push origin v0.1.1
```

构建前，流水线将标签中的版本写入 runner 工作目录内的 `dsh-pet/package.json` 和 `openapi.yaml`。npm 归档、Windows 桌面应用和机器人包均使用该版本。这些修改不会提交或推回仓库。源码版本仍用于本地构建和手动分支构建。

## 自动执行顺序

| 阶段                | 内容                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| 准备版本            | 校验包名与标签格式，将标签版本写入包和 OpenAPI 元数据                                                         |
| 构建                | 按锁文件安装依赖，跑单测和完整 `npm pack` 发布前检查                                                         |
| 验证                | Chromium UI / 脚本测试，实装归档并检查 CLI `--help` / `--check`                                              |
| 保存产物            | 生成 SHA256SUMS，上传已测试安装包为 Actions artifact，保留 14 天                                             |
| 可选 npm 发布       | 核对校验和，发布同一份归档，不再执行包内生命周期脚本                                                         |
| 创建 GitHub Release | 自动生成说明，附上归档和校验文件                                                                             |
| 桌面构建            | 调用 Windows workflow，将 `dsh-pet-powercontext-<version>-desktop-windows-x64-standard.zip` 挂到同一 Release |

`alpha.N`、`beta.N`、`rc.N` 分别使用对应 npm 通道，并创建 GitHub 预发布；正式版本使用 `latest`。手动运行 **Release** 只验证和打包，即使选择标签也不会发布。进入 **Actions → Release → Run workflow**，可选填 `ref` 来检查指定分支、标签或 PR 引用。

手动构建标签时使用所选标签的版本；手动构建分支或 PR 时使用该工作目录中已提交的版本。明确指定标签可填写 `refs/tags/v0.1.1`，明确指定分支可填写 `refs/heads/<branch>`。无效的发布标签会在修改版本字段前终止构建。

独立的 **Robot slim bundles** 流水线也由推送 `v*` 标签或手动操作触发。它将各平台安装包保存为 Actions artifacts，不会上传到 GitHub Release 或发布到 npm。

## 失败后怎样处理

构建或测试失败会停止发布。开启 npm 后，npm 失败会阻止创建 GitHub Release。之后 Windows 构建失败，不会回滚已经发布的 npm 和 Release；可以手动运行 `release-app`，填写原标签补传 ZIP。

npm 已发布的版本不能覆盖。如果 npm 已成功、后续步骤失败，不能假设重跑整个流程会自动跳过 npm，目前没有这项恢复逻辑。先确认哪些产物已经存在，再选择重试步骤。修改安装包内容后使用新版本。

## 本地检查安装包

在内层包目录运行 `npm pack --pack-destination /仓库外的绝对目录`，会执行完整 prepack 检查。归档、冒烟安装目录和日志留在仓库外；本机 Linux 使用 `/data/codex-tmp/` 并设置 `TMPDIR`。
