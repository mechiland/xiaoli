# 目标

在这个项目里，从零做出一个可以在本地完整运行、之后能部署到 Cloudflare 的关系记忆 Web 应用。产品规格以 `PLAN.md` 为准。

完成的定义是：一个新用户注册后，把微信导出的聊天记录 ZIP 拖进页面，确认聊天里的人是谁，几分钟内在导入结果页看到"关于每个人有哪些新信息"，确认后，这些信息以带证据的形式出现在百科式的人物页上，并且能通过别名和信息正文搜到。整条路径没有控制台错误、没有失败请求，界面符合 `PLAN.md` 第 9 节和 Loam 设计语言，抽取质量达到下文的门槛。

技术栈固定：Next.js（App Router）、Better Auth、Hono、Drizzle ORM、Cloudflare D1 与 R2（本地通过 OpenNext 的 dev 绑定使用）、Tailwind、shadcn/ui、TanStack Query。

# 抽取模型

- 模型名 `deepseek-flash`，DeepSeek 官方 API，OpenAI 兼容格式。base URL、JSON 输出方式、参数以 DeepSeek 官方文档为准，开工时查一次并写入 `docs/DECISIONS.md`。
- API key 在 `.env.local` 的 `DEEPSEEK_API_KEY`。模型名放在 `EXTRACT_MODEL`，默认 `deepseek-flash`。部署时通过 `wrangler secret put` 配置，不写进任何配置文件。
- LLM 调用只能经过 `server/llm/` 的适配器接口。`PLAN.md` 中写的 Anthropic 适配器以本文件为准替换为 DeepSeek。
- 每次调用记录模型、提示词版本、输入输出 token 数、耗时、原始输出。

# 工作方式

## 1. 架构先行

写任何功能代码之前，先写 `ARCHITECTURE.md`：

- **模块划分**，每个模块一个目录，写明负责人边界：
  - `core`：Drizzle schema 与迁移、Hono app 组装、Better Auth、Loam 主题与设计 token、根布局与顶栏。
  - `parser`：`lib/wechat-export`，浏览器与服务端共用，无 Node 依赖。
  - `llm`：适配器接口与 DeepSeek 实现、调用记录、录制回放。
  - `import`：导入相关 API、浏览器端解压与上传、导入浮层、消息去重对齐。
  - `extract`：分窗、提示词、zod 校验、入库、判重与 supersede、任务推进端点。
  - `review`：用户操作记录（确认、拒绝、改写、过时、合并、拆分）及其 API，证据查询。
  - `person`：人物页与信息框、证据组件。
  - `search`：搜索 API 与搜索浮层。
  - `home`：首页、首次使用引导与空状态。
  - `import-result`：导入结果页。
  - `chat`：聊天原文页。
  - `settings`：设置页、数据导出与删除。
  - `deploy`：wrangler 配置、OpenNext 配置、部署脚本。
- **共享契约**：所有跨模块数据类型用 zod 定义在 `core`，API 通过 Hono RPC 导出类型。每个模块写明对外暴露的函数、路由、组件及其输入输出。
- **约定**：时间统一 ISO 字符串，消息时间 `YYYY-MM-DD HH:MM` 本地时间；ID 为整数自增；所有业务查询带 `ownerId`。
- **确定性**：LLM 输出不确定，所以抽取管线的自动化测试一律使用录制回放（`fixtures/cassettes/`），只有评测和显式的 `--live` 模式调用真实 API。temperature 取文档建议的最低可用值。
- **性能预算**：浏览器端解析 5000 条消息的 ZIP ≤ 3 秒；人物页服务端响应 ≤ 300ms（本地，200 个人物、5000 条 claim 的种子数据）；首页 ≤ 300ms；单个抽取窗口端到端 ≤ 30 秒。
- **故障隔离**：单个抽取窗口失败（超时、非法 JSON、校验失败）重试最多 2 次，仍失败则标记 failed，其余窗口继续，导入结果页显示失败窗口数并可重试。任何一个页面的数据加载失败，只让该区块显示错误状态，不让整页崩溃。

## 2. 先建验证回路，再做功能

在 `core` 可用之后、任何功能模块之前，建好这三样东西：

- **端到端截图工具**（Playwright）：`pnpm verify <场景>`。启动或连接开发服务器，用种子账号登录，执行场景脚本，在桌面宽度 1440 和窄屏宽度 390 分别截图，输出 PNG 和一份 JSON 日志，内容包括控制台错误、失败的网络请求、非 2xx 的 API 响应、各页面加载耗时。截图与日志写入 `artifacts/<场景>/<时间戳>/`。
- **种子数据**：`pnpm seed` 生成合成数据（200 个人物、若干聊天、覆盖所有 claim 类别、未确认条目、被取代条目、农历生日）。合成聊天记录 ZIP 放在 `fixtures/synthetic/`，覆盖 `PLAN.md` 第 6 节列出的全部消息类型和边界情况。
- **抽取评测**：`pnpm eval`。对 `fixtures/real/` 和 `fixtures/synthetic/` 中的每个 ZIP，用对应的金标准 `eval/gold/<文件名>.json` 计算 claims、relations、handles、dates 各自的精确率与召回率，每 100 条消息的产出数，以及错误分类（事实错误、归错人、过度推断、应忽略却记录、敏感信息进入正文、证据引用了窗口外或不存在的消息）。结果写入 `eval/reports/<时间戳>.json`。

金标准由一个独立的标注 agent 按 `PLAN.md` 第 8.7 节的规则逐条标注，标注时看不到管线输出。标注完成后不得为了提高分数修改金标准；发现金标准本身错误时，记录在 `docs/DECISIONS.md` 并说明原因。

每个界面模块都要提供一个 showcase 场景：用种子数据直接呈现该模块的代表性状态（包括空状态、加载中、错误、长内容、窄屏）。

任何 agent 不得声称自己没有截图并亲自看过的东西已经完成。

## 3. 分波次并行

使用多 agent 编排。每个模块一个 builder agent，只能修改自己的目录。按依赖分波：

1. `core`、`parser`、`llm`，以及验证回路。
2. `import`、`extract`、`review`、`search`。
3. `person`、`import-result`、`home`、`chat`、`settings`。
4. `deploy`，以及完整流程的集成。

每波之间由一个 integrator agent 处理衔接。它是唯一可以修改 `core` 的 agent，负责合并各 builder 提交的 core 变更请求（写在 `docs/core-requests/<模块>.md`）、修复模块间的接缝、保证类型检查和全部测试通过。

## 4. 每个模块过关

每轮 builder 完成后，由独立的 critic agent 检查。critic 不写代码。

**界面模块的 critic** 是一位严格的产品设计总监。它自己跑 showcase 场景和端到端场景，在两种宽度下截图并逐张看，逐条对照 `PLAN.md` 第 9 节的交互规定和 9.1 的 Loam 规范，检查 9.3 列出的禁止元素是否出现，检查控制台错误和性能预算。按 0–10 打分：

- 10：像一本编辑精良的参考书，信息层级、字体、留白、交互反馈都经得起逐像素审视。
- 8.5：可以交付，只剩细节问题。
- 7：像一个认真做过的后台模板。
- 5：默认主题的 shadcn 管理后台。

过关条件：≥ 8.5，零控制台错误，零失败请求，性能预算全部满足，第 9 节规定无遗漏、禁止元素零出现。

**后端模块的 critic** 检查 API 契约与 `ARCHITECTURE.md` 是否一致、类型检查、单元测试与集成测试、`ownerId` 隔离（用两个账号交叉访问验证）、故障隔离行为、删除语义。过关条件：全部通过，无跳过的测试。

**`extract` 模块的 critic** 运行 `pnpm eval`。过关条件：

- claims 精确率 ≥ 0.85，召回率 ≥ 0.70
- handles 与 relations 精确率 ≥ 0.90
- 敏感信息进入正文：0
- 证据引用无效消息：0
- 事务类信息被记录为 claim 的比例 ≤ 5%

未过关时，critic 给 builder 一份按严重程度排序的问题清单，builder 再做一轮。每个模块最多 4 轮。4 轮仍未过关，记录现状与剩余问题，继续后面的工作，在下一次循环中优先处理。

## 5. 最终关

全部模块过关后：

- **整体 critic** 走完整流程：新账号注册 → 首次使用引导 → 依次导入 `fixtures/real/` 中的全部 ZIP → 在导入结果页处理所有条目（确认、拒绝、改写、合并各至少一次）→ 进入每个涉及的人物页展开证据 → 搜索别名和信息正文 → 从证据跳到聊天原文页 → 删除一次导入并验证派生条目的变化。整体打分，标准同界面 critic。
- **盲评**：把我们的人物页、首页截图与 Monica 的联系人页、dashboard 的公开截图配对，只标 A 和 B，顺序随机。由没有参与开发的 judge agent 回答两个问题：哪一个更能帮你记住这个人、哪一个看起来更用心，并说明理由。记录结果，不以此作为过关条件。

## 6. 循环直到全部过关

用 `/loop` 持续迭代，直到所有 critic 过关。每轮结束把状态写入 `docs/STATUS.json`：

```json
{
  "updatedAt": "",
  "modules": {
    "<模块>": {
      "round": 0,
      "score": null,
      "passed": false,
      "openIssues": [],
      "lastArtifacts": ""
    }
  },
  "eval": { "latestReport": "", "passed": false },
  "llmUsage": { "inputTokens": 0, "outputTokens": 0 },
  "blockers": []
}
```

每次循环从 `STATUS.json` 中分数最低、未过关的模块开始，不从头重来。

# 规则

- 不虚报分数。如实记录每一轮的真实分数、失败的轮次和仍然缺的东西。
- 不修改其他模块的目录。core 变更走 integrator。
- 开发服务器始终保持运行，应用始终可加载，其他 agent 在对它截图。
- 不向我提问。常规决定自己做，把假设和取舍写进 `docs/DECISIONS.md`，继续推进。与 `PLAN.md` 不一致的做法同样记录在那里并说明理由。
- **真实数据**：`fixtures/real/`、`eval/gold/` 中的真实样本、以及使用真实数据生成的 `artifacts/` 全部在 `.gitignore` 中。真实聊天中的手机号、住址、姓名不得出现在提交的代码、测试、日志、文档里。提交的测试和 showcase 只用合成数据。
- **密钥**：`.env.local` 不提交，不在日志、截图、错误信息里输出 API key。
- **模型调用成本**：单次循环的抽取与评测调用合计不超过 300 万 token，超出即停止调用真实 API，改用录制回放继续其他工作，并在 `STATUS.json` 的 `blockers` 中记录。
- **提示词版本**：修改抽取提示词必须递增版本号，重新跑评测，把新旧版本的指标对比写进 `eval/reports/`。

现在开始。
