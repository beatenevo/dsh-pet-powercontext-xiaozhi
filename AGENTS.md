# 仓库协作约定

适用于本仓库。用户当前任务中的明确要求优先；以下是未另行指定时的默认约定。

## 分支、提交与 PR

- 新功能分支基于最新 `origin/master` 创建，默认使用 `codex/` 前缀。先检查工作区，保留已有未提交改动。
- 用户要求合并 master 时，先 fetch，再合并 `origin/master`。逐处理解冲突，保留双方仍然需要的行为，不能整文件选择 ours/theirs 后直接视为完成。
- 提交前检查实际 diff，只提交当前任务相关文件；日志、截图、视频和 `.playwright-cli/`、`output/` 等临时产物不随功能提交，除非用户明确要求。
- 提交信息遵循 `type(scope): subject`，并说明具体实现或行为变化，参见 [git-commit](.agents/skills/git-commit/SKILL.md)。提交和推送需在用户授权范围内。
- **PR 标题和描述必须使用英文。** 描述针对最终实现，说明解决的问题、行为变化、验证结果及实际限制；后续修改使范围变化时，同步更新描述。
- 创建或更新 PR 后，核对远端 head、base、标题和描述，并向用户返回 PR 链接。

## 实现与验证

- 插件代码与注释遵循 [dsh-plugin-standards](.agents/skills/dsh-plugin-standards/SKILL.md) 和 [dsh-plugin-comment-spec](.agents/skills/dsh-plugin-comment-spec/SKILL.md)，此处不复制其细则。
- Node.js 版本应满足 `dsh-pet/package.json` 的 engines；项目命令在 `dsh-pet/` 目录执行。
- 代码变更交付前运行相关测试及以下门禁：`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run check:cycles`、`npm run check:runtime`、`npm run check:openapi`、`npm test`、`npm run build`。纯文档修改只做相关格式、链接和内容检查。
- 合并冲突涉及配置、接口或打包时，验证合并后的实际行为。打包清单变更需检查构建产物及 npm 包文件列表，不能只验证冲突标记消失。
- 临时测试数据、日志和验证产物放在 `/data/codex-tmp/`，测试时设置 `TMPDIR`；不要覆盖或清理用户已有产物。
- 报告实际运行的检查和结果。分别说明本地测试、远端 CI、合并状态及尚未验证的部分，不将其中一项通过等同于整体可发布。

## 机器人与外部服务

- 以运行时发现的 MCP 工具定义为准；保留外部标识符的原始类型，尤其不要把长整数形式的字符串 ID 转换为 JavaScript Number。
- 保留物理动作的逐次确认和串行执行。超时、断连或取消等待后，不自动重试可能已经下发的动作。
- 只展示服务实际提供的能力。没有停止工具时，必须明确“取消本地等待”不代表设备停止；连接成功也不代表机器人静止。
- 模拟服务测试、协议成功响应和 UI 截图不能作为实机完成动作的证据。实机或真实后端尚未验证时明确说明。
