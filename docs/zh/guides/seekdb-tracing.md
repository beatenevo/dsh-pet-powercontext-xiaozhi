# 大肥鱼 → PowerContext → seekdb → 可观测页面

桌宠现有的独立 PowerContext 记忆客户端会将 `traceparent` 传给 Server。此仓库随 npm 包交付一个可选的 Python 服务入口，补齐同一请求下的 seekdb 查询 span。无需修改 `site-packages`，也不依赖录屏目录、临时进程或开关文件。

## 安装与启动

手工部署需要 Python 3.12+，以及支持嵌入式 seekdb 的 Linux/macOS 环境。PowerContext 使用固定版本的 Python 发布包，无需安装 Git。在仓库根目录执行；使用 npm 安装时，将路径替换为包内 `runtime/powercontext`：

```bash
python3.12 -m venv .venv-seekdb
.venv-seekdb/bin/python -m pip install -r dsh-pet/runtime/powercontext/requirements.txt

export POWERCONTEXT_HOME="$PWD/.powercontext-seekdb"
export POWERCONTEXT_SERVER_DATABASE="{\"kind\":\"seekdb\",\"path\":\"$PWD/.powercontext-seekdb/database\",\"database\":\"powercontext\"}"
export POWERCONTEXT_SERVER_HTTP__HOST=127.0.0.1
export POWERCONTEXT_SERVER_HTTP__PORT=8000
export POWERCONTEXT_SERVER_TRACING__ENABLED=true
export OTEL_SERVICE_NAME=powercontext-seekdb
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://vision.example/api/public/otel/v1/traces
export OTEL_EXPORTER_OTLP_TRACES_HEADERS='Authorization=Basic%20BASE64_OF_AGENT_UUID_COLON_SPACE_KEY'

.venv-seekdb/bin/python dsh-pet/runtime/powercontext/server.py --sql-text
```

OTLP 端点、Agent 和凭据必须与桌宠的[可观测配置](observability.md)一致。示例凭据需要替换，不要把真实值提交到 Git。服务沿用 PowerContext 的认证和网络暴露校验，不绕过认证。`requirements.txt` 固定经验证的 PowerContext 发布版本及 seekdb/MySQL 驱动；升级这些依赖时须重跑集成测试。

数据库目录应为新目录或已完成受支持迁移的 seekdb 数据目录。同一目录只运行一个 Server。SQLite 数据不会自动转成 seekdb；切换前按 PowerContext 的导出／导入流程迁移。入口拒绝 SQLite 回退。首次建库需要执行迁移，可能持续数分钟；等待服务就绪后再发起对话。

按 [长期记忆配置](memory.md) 配置 PowerContext 的生成模型与嵌入模型。桌宠选择独立 PowerContext 后端，`chatMemory.serverUrl` 指向此服务；沿用原有认证配置。这里改变的是 Server 的数据库，不是把桌宠的后端名称改为 seekdb。

## 实际验证路径

1. 向大肥鱼告知预算或资料位置，确认 Source 送达；等待提炼后，在“记得的事”看到对应事实。
2. 再次提问，确认回答使用已召回事实；打开来源核对原始对话。
3. 在最近交互打开可观测页面：聊天 → 记忆召回 → Server 准备上下文／检索 → `seekdb.SELECT` 或 `seekdb.WITH`。
4. 启用 `--sql-text` 后，可在 SQL 属性中看到脱敏的全文检索 `MATCH`、向量检索 `l2_distance` 模板及耗时。数据量、检索方式与配置决定实际出现哪些语句。
5. Token 对照继续使用真实提供商返回计数；回答阶段与包括记忆准备的总量分开解释，不能承诺每个问题都节省。

## 开关与证据边界

- 默认随 Server 的 tracing 开关记录 SQL 操作和耗时，不记录 SQL 文本。`--sql-text` 显式启用脱敏模板；不导出绑定参数、结果或异常正文。模板包含表名、列名等结构信息。
- `--no-sql-tracing` 关闭数据库 span；Server tracing 关闭时也不安装监听器。只跟随有效、已采样的父链路，不为初始化 SQL 创建孤立根链路。
- 只观察此入口配置的 `mysql+aseekdb` 数据库，其他数据库连接不会被误标为 seekdb。监听器随服务退出卸载，导出失败不改变数据库操作结果。
- 本入口覆盖 Server 进程的查询。PowerContext 独立后台进程不自动继承 Python 监听器；不承诺后台所有 SQL 或数据库内部执行计划可见。
- Astra 2.0 沿用[机器人控制链路](robot.md)，可发送已配置的示教动作与语音播报。观测不会发起动作；SDK 回执不等于实体完成，硬件验证需连接设备并遵守现有动作授权。

## 回归测试

```bash
.venv-seekdb/bin/python -m unittest discover -s dsh-pet/runtime/powercontext -p 'test_*.py' -v
DSH_SEEKDB_INTEGRATION=1 .venv-seekdb/bin/python -m unittest discover -s dsh-pet/runtime/powercontext -p 'test_*.py' -v
```

第二条会创建临时真实 seekdb，验证写入、全文与向量 SQL、上下文召回和 HTTP 父链路。测试嵌入模型使用确定性向量，不需要供应商密钥；它验证真实数据库与调用链，不证明模型质量或 Token 节省。源码地图见包内 `runtime/powercontext/README.md`。
