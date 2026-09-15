# 小丽· 产品 v1 计划

## 1. 要做的东西

一个本地可以跑起来、之后部署到 Cloudflare 的 Web 应用。核心流程：

**上传微信聊天记录 ZIP → 确认聊天里的人是谁 → AI 抽取 → 看到"这次关于每个人有哪些新信息" → 确认后并入人物档案。**

界面采用百科式的两页结构（首页与人物页），视觉沿用 LifeBox 的 Loam 设计语言。人物页的内容不是手工录入的，是从聊天记录里长出来的，每一条都能点回原话。

v1 是单用户部署：一个人部署给自己用。账号体系有，是为了保护公网上的实例，不是为了多租户。所有业务表仍带 `ownerId`，给以后留路。

## 2. 不做

人情账本（导出中转账红包无金额）、语音识别（导出中语音只有时长）、事务类信息（只抽和人有关的内容）、提醒推送（v1 只在首页展示即将到来的日期）、移动端分享扩展、多租户与计费。

## 3. 原则

- **AI 抽出的每一条都有证据。** 指向具体消息，界面上可以展开看原话和上下文。手动添加的条目来源标记为 manual。
- **AI 只提议。** 抽取结果是 `proposed`，用户在导入结果页确认后变 `confirmed`。被新信息推翻的标 `superseded`，保留历史。
- **不推断原文没说的东西。** 称呼语（"老爸""儿子"）是关系的直接证据；"你儿子不 care"不能推出说话人与孩子的关系。
- **敏感字段不进正文。** 手机号、证件号、详细住址、银行信息不写进断言文本。
- **ZIP 在浏览器里解析。** 服务器只收到解析后的消息 JSON 和用户勾选的图片，视频默认不上传。
- **真实导出不进仓库。**

## 4. 技术架构

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 前端 | Next.js（App Router）+ Tailwind + shadcn/ui | 页面与组件 |
| 数据请求 | TanStack Query + Hono RPC client（`hc`） | 端到端类型 |
| API | Hono，挂在 `app/api/[[...route]]/route.ts` | 一个 Next 应用内完成，不拆服务 |
| 认证 | Better Auth，邮箱密码，挂在 Hono 的 `/api/auth/*` | Drizzle adapter，sqlite provider |
| ORM | Drizzle（`drizzle-orm/d1`） | schema 用 `sqlite-core` |
| 数据库 | Cloudflare D1 | 本地开发即用 D1 本地模拟，不用 better-sqlite3 |
| 文件 | Cloudflare R2 | 图片附件 |
| 部署 | `@opennextjs/cloudflare` | 本地 `next dev` 通过 `initOpenNextCloudflareForDev` 拿到 D1/R2 绑定 |
| ZIP 解析 | fflate（浏览器端） | |
| LLM | Anthropic API，通过适配器接口调用 | 模型名与 API key 放环境变量 |
| 农历 | lunar-typescript 或同类库 | 日期换算 |

决定与理由：

- **本地就用 D1 绑定，而不是本地 SQLite 文件 + 上线切 D1。** 驱动、事务行为、迁移命令从第一天就和线上一致，避免部署时才发现差异。迁移用 `drizzle-kit generate` 生成 SQL，`wrangler d1 migrations apply --local` / `--remote` 执行。
- **Better Auth 按请求创建实例。** D1 绑定只在请求上下文里可用，`auth` 不能是模块级单例，封装成 `getAuth(env)`。
- **抽取任务不在单个请求里跑完。** 一次导入按窗口拆成多个任务，存在 `extraction_jobs` 表。v1 由一个 API 端点逐个处理：前端导入页轮询时触发"处理下一个待办窗口"，每个请求只处理一个窗口，处理完返回进度。实现简单，本地和 Workers 行为一致，不会撞请求时长上限。上线稳定后再迁移到 Cloudflare Workflows 或 Queues，任务表结构不变。
- **开工前先核对版本兼容。** OpenNext Cloudflare 支持的 Next.js 版本范围、Better Auth 在 D1 上的已知问题，以各自最新文档为准，锁定版本写进 README。

## 5. 目录结构

```
.
├── app/
│   ├── (auth)/sign-in/
│   ├── (app)/
│   │   ├── page.tsx                 # 首页
│   │   ├── p/[id]/                  # 人物页
│   │   ├── imports/[id]/            # 导入结果页
│   │   ├── chats/[id]/              # 聊天原文页（仅从证据进入）
│   │   └── settings/
│   └── api/[[...route]]/route.ts    # Hono 入口
├── server/
│   ├── app.ts                       # Hono app，组合路由，导出 AppType
│   ├── routes/                      # imports, people, chats, claims, review, home, search
│   ├── auth.ts                      # getAuth(env)
│   ├── db/schema/                   # drizzle schema，按领域分文件
│   ├── db/client.ts
│   ├── extract/                     # 分窗、提示词、校验、入库、判重
│   └── llm/                         # 适配器接口 + anthropic 实现
├── lib/
│   ├── wechat-export/               # 浏览器与服务端共用的解析器（纯 TS，无 Node 依赖）
│   └── api-client.ts                # hc<AppType>
├── prompts/extract.v1.md
├── drizzle/                         # 生成的迁移
├── fixtures/synthetic/
├── fixtures/real/                   # gitignore
├── wrangler.jsonc
└── open-next.config.ts
```

## 6. 微信导出格式规格

基于 3 份真实样本（iOS 微信，2026 年 9 月）。

ZIP 文件名 `聊天记录_YYYYMMDD_HHMMSS.zip`，时间为导出时间。内容：

```
聊天记录.txt
聊天记录内的图片、视频和文件/微信图片_YYYYMMDDHHMM_N.jpg
聊天记录内的图片、视频和文件/微信视频_YYYYMMDDHHMM_N.mp4
```

`聊天记录.txt` 为 UTF-8，每条消息：

```
·<发送者显示名>
YYYY年MM月DD日 HH:MM
<正文，可多行>
<空行>
```

切分规则：某行以 `·` 开头，且下一行完全匹配 `^\d{4}年\d{2}月\d{2}日 \d{2}:\d{2}$`，即一条消息的起点。正文为到下一个起点前的内容，去掉首尾空行。

| 正文形式 | kind | 说明 |
| --- | --- | --- |
| 普通文本，可多行，可含 Unicode 表情 | text | |
| 整条仅由 `[流泪]`、`[OK]` 这类代码组成 | sticker_code | 代码也会混在文本里 |
| `[图片] 文件名` | image | 文件名可能为空，附件缺失 |
| `[视频] 文件名` | video | |
| `[语音] 14"` | voice | 只有时长 |
| `[转账]` / `[转账] 朋友已确认收款` | transfer | 无金额 |
| `[微信红包] 祝福语` | red_packet | 无金额 |
| `[小程序] 标题` | mini_program | |
| `[视频号] 标题 URL` | channels | |
| `[动画表情]` / `[动画表情] 标签` | animated_sticker | |
| `[视频通话]` | video_call | |
| 其他 `[xxx]` 前缀 | unknown | 保留原文 |

导出中没有：聊天标题、私聊/群聊标记、成员列表、wxid、消息 ID、秒、时区。媒体文件修改时间不可信。

显示名：私聊中对方显示为用户设置的备注名；群聊中显示为对方昵称或群昵称；用户自己显示为自己的微信名。群聊正文中 `@显示名 称呼` 是别名的强证据。

未见样本、需补充：引用回复、撤回、合并转发嵌套、名片、位置、文件、链接、群系统消息、Android 版格式。

## 7. 数据模型

Drizzle schema 按下列结构实现。所有业务表带 `ownerId`（Better Auth 的 user id）、`createdAt`、`updatedAt`，下文省略。时间统一存 ISO 字符串。

### 导入层

**chats**：`id`, `title`, `kind`（private | group）, `note`

**imports**：`id`, `chatId`, `fileName`, `fileSha256`（同一 owner 下唯一）, `exportedAt`, `status`（parsed | mapping | extracting | reviewing | done | failed）, `messageCount`, `newMessageCount`, `dateFrom`, `dateTo`, `stats`（JSON：各类型数量）, `error`

**messages**：`id`, `chatId`, `firstImportId`, `senderHandleId`, `sentAt`（'YYYY-MM-DD HH:MM'）, `seq`, `kind`, `body`, `fingerprint`；唯一约束 `(chatId, seq)`

**attachments**：`id`, `messageId`, `kind`, `fileName`, `r2Key`（未上传或缺失为 null）, `byteSize`, `mime`

### 身份层

**persons**：`id`, `label`, `isSelf`, `mergedIntoId`, `pinned`（是否关注）, `avatarR2Key`, `lastMessageAt`（冗余字段，导入时更新）

**handles**：`id`, `personId`（可空）, `kind`（display_private | display_group | mentioned | real_name | address_term）, `value`, `chatId`（作用域，可空）, `status`, `importId`；唯一约束 `(ownerId, kind, value, chatId)`

**relations**：`id`, `fromPersonId`, `toPersonId`, `type`, `label`, `status`, `importId`, `sourceKind`（ai | manual）

### 记忆层

**claims**：`id`, `personId`, `statement`, `category`（work | location | education | family | preference | life_event | other）, `validFrom`, `validTo`, `learnedAt`, `confidence`, `sensitive`, `status`（proposed | confirmed | rejected | superseded）, `supersedesClaimId`, `supersededByClaimId`, `importId`, `sourceKind`

**events**：`id`, `summary`, `happenedAt`, `place`, `status`, `importId`, `sourceKind`；**eventParticipants**：`eventId`, `personId`

**importantDates**：`id`, `personId`, `kind`, `day`, `month`, `year`, `calendar`（solar | lunar）, `label`, `status`, `importId`, `sourceKind`

**evidence**：`targetType`（handle | relation | claim | event | date）, `targetId`, `messageId`；联合主键

### 任务与审计

**extractionJobs**：`id`, `importId`, `windowStartSeq`, `windowEndSeq`, `status`（pending | running | done | failed）, `attempts`, `model`, `promptVersion`, `rawOutput`, `error`

**reviewLog**：`id`, `targetType`, `targetId`, `action`（accept | reject | edit | merge | split | supersede）, `before`, `after`

### 删除语义

删除一个 import：删除它首次引入的消息，删除只由这些消息作为证据的派生条目；派生条目若还有其他证据，只移除对应 evidence 行。删除一个人物：级联删除其 handles、claims、dates、relations、evidence，消息保留但 sender 置为未知。

## 8. 导入与抽取管线

### 8.1 浏览器端解析

用户选择 ZIP 后在浏览器内：fflate 解压 → 计算 SHA-256 → `lib/wechat-export` 解析 → 展示预览：消息数、时间范围、发送者列表及各自条数、类型分布、图片和视频数量及体积。用户可取消勾选附件，视频默认不勾选。

### 8.2 上传

`POST /api/imports`：提交解析结果（消息数组、附件清单、文件名、哈希）。服务端校验哈希未重复，创建 import，状态 `mapping`。勾选的图片通过 `PUT /api/imports/:id/attachments/:name` 写入 R2。

### 8.3 聊天与人物映射（向导第二步）

- **选择聊天：** 系统按发送者显示名在已有 handles 中查找，推荐已有聊天；或新建聊天，填标题并选私聊 / 群聊。只有两个发送者时预选私聊，但要求用户确认。
- **映射发送者：** 每个显示名一行，选项为：我自己 / 已有人物（带搜索，带系统推荐）/ 新建人物。命中设置里 `selfDisplayNames` 的自动选中"我自己"。私聊中对方默认新建或匹配已有人物。
- 提交后：写入 handles（confirmed，因为是用户显式选择的）、消息入库、状态变为 `extracting`，按窗口生成 extractionJobs。

### 8.4 消息去重

同一聊天已有消息时，按 fingerprint 序列与已有消息做对齐（最长公共子序列），对齐部分复用已有 message，其余插入并重排 seq。不逐条按 fingerprint 去重，同一分钟里的两个"嗯"会撞。只对新增消息所在的窗口生成抽取任务，窗口两侧各带 20 条已有消息作上下文。

### 8.5 分窗

相邻消息间隔超过 3 小时切为新会话；单个会话超过 150 条按 150 条切，窗口重叠 20 条。

### 8.6 单窗口抽取

`POST /api/imports/:id/jobs/next`：领取一个 pending 任务，执行，返回整体进度。

输入给模型：窗口消息，格式 `#seq [时间] 发送者显示名(person_id): 正文`；该聊天涉及人物的已知信息摘要（label、所有 handles、confirmed 的 claims 列表带 id）；self 的 person_id。

输出 schema（zod 严格校验）：

```ts
type PersonRef = { personId: number } | { tempId: string }

{
  newPersons: { tempId: string; label: string; evidence: number[] }[]
  handles:    { person: PersonRef; kind: 'mentioned'|'real_name'|'address_term';
                value: string; evidence: number[] }[]
  relations:  { from: PersonRef; to: PersonRef; type: string; label?: string;
                evidence: number[] }[]
  claims:     { person: PersonRef; statement: string; category: Category;
                validFrom?: string; confidence: number; sensitive: boolean;
                supersedesClaimId?: number; evidence: number[] }[]
  events:     { summary: string; happenedAt?: string; place?: string;
                participants: PersonRef[]; evidence: number[] }[]
  dates:      { person: PersonRef; kind: string; day?: number; month?: number;
                year?: number; calendar: 'solar'|'lunar'; evidence: number[] }[]
}
```

入库前校验：evidence 中的 seq 必须在窗口内，否则丢弃该条；tempId 在本 import 范围内解析，跨窗口按 label 与证据合并；与本 import 中已提议或已确认的 claim 语义重复的，合并 evidence 不新增（判重调用一次模型，输入同一人物的候选列表）。

### 8.7 提示词要点（prompts/extract.v1.md）

- 只记录关于人的、一个月后仍然有用的信息。即时协调（"你们先吃""我在门口"）不记。
- 事务信息只保留在人身上的投影："柜子报价、工期"不记，"丽娟做柜子"记。
- 不推断原文没有说的关系。称呼语是关系的直接证据。
- `@显示名 称呼` 是别名的强证据。
- 新信息与已知 claim 冲突时（换工作、搬家、升学），输出新 claim 并填 `supersedesClaimId`。
- 手机号、证件号、详细住址、银行信息不写入 statement；对应 claim 写成"提供过收货地址"并标 `sensitive: true`。
- 语音、转账、红包内容不可见，不猜内容或金额。
- 每条输出必须有 evidence。

## 9. 界面与交互

### 9.1 设计语言

沿用 LifeBox 的 Loam 设计语言。shadcn/ui 作为组件基础，主题整体重写。

| 项 | 规定 |
| --- | --- |
| 底色 | 暖白 `#F2EEE3`；卡片与浮层用略浅一档的暖白，靠底色差区分层级 |
| 字体 | 中文标题 Noto Serif SC；正文中文系统无衬线；数据、标签、时间用 Inter |
| 圆角 | 近方角，2px 以内 |
| 阴影 | 不用。层级靠底色差与 1px 细线 |
| 颜色 | 低饱和。状态色只用于未确认、已取代等少数状态；emoji 是界面上唯一的彩色变化 |
| 密度 | 接近阅读页面而非后台管理界面：正文行高宽松，列表紧凑 |

### 9.2 信息架构

采用 Wikipedia 式的两页结构：**首页**和**人物页**。页面之间靠链接跳转，用浏览器的前进后退返回，不做侧边栏，不做层级导航。

顶栏在所有页面一致：左侧产品名（回首页），中间搜索入口，右侧"导入"按钮和账户菜单（设置、退出）。

另有四个辅助界面，都不进入导航：

- **导入浮层**：全局，任何页面可唤起。
- **导入结果页** `/imports/:id`：只在导入完成后进入，或从首页"最近导入"进入。
- **聊天原文页** `/chats/:id`：只从证据跳转进入。
- **设置页** `/settings`：从账户菜单进入。

路由：

```
/                    首页
/p/:id               人物页
/imports/:id         导入结果页
/chats/:id?at=:msgId 聊天原文页
/settings            设置
```

### 9.3 不做的交互

以下界面元素一律不出现：通知、角标、待办计数、红点、"好久没联系"一类的提醒列表、连续使用天数、全局的"待确认"收件箱。未确认的条目只出现在它所属的人物页和它所属的导入结果页里。

### 9.4 首页 `/`

从上到下：

- **搜索框**：页面上最大的元素，占据首屏中心位置，点击唤起搜索浮层（见 9.8）。
- **即将到来**：未来 30 天的重要日期，每行"人名 · 事项 · 日期 · 还有几天"。农历日期同时显示公历换算。没有则整块不显示。
- **最近有新信息的人**：最近几次导入中有新确认条目的人物，每人一行，附上最新的一条信息。
- **关注的人**：用户在人物页上标记关注的人。
- **全部人物**：按拼音首字母分组的索引，形式参照百科的条目索引，每个名字是链接。人物多于 200 时默认折叠，只显示字母导航。
- **最近导入**：最近 5 次导入，每行"聊天名 · 时间范围 · 导入时间"，链接到导入结果页。字号小，放在页面底部。

### 9.5 人物页 `/p/:id`

版式参照百科条目：正文居左，信息框居右。窄屏时信息框移到标题下方。

**标题区**

- 人物 label，Noto Serif SC 大标题。
- 标题下一行小字："又名：丽娟、容尹"，列出所有已确认的别名。点击展开，按类型分组显示（私聊备注名、群内显示名、真名、称呼）及各自出现的聊天。
- 标题右侧"关注"开关，以及"⋯"页面工具菜单：合并到其他人物、拆出别名、删除此人。

**信息框（右栏）**

固定字段，有值才显示：与我的关系、所在城市、工作、学校、生日（显示下一次日期与剩余天数）、其他重要日期、共同聊天（每个聊天一行，含消息数与最后一次消息时间）、最后联系时间。

信息框的值来自 claims 与 importantDates 的查询，不单独存储。每个值同样带证据标记。

**正文（左栏）**

按类别分节，节标题用 Noto Serif SC：工作、所在地、教育、家庭、偏好与习惯、经历、其他。没有内容的节不显示。

- 每条 claim 渲染为一句话，句末带上标序号证据标记，形式同百科脚注，如"在汉中读高中。¹"。
- claim 中提到的其他人物渲染为链接，点击进入对方人物页。
- 有 validFrom 的在句末用小字标注时间。
- **未确认的条目**直接出现在所属小节中，文字颜色降一档，左侧一条细竖线，句末带"确认 / 不对"两个文字按钮。不集中、不置顶、不计数。
- 悬停一条已确认的 claim，右侧出现"改写 / 已过时 / 删除"。
  - **改写**：原地变为输入框，保存后显示新文本，原文本移入"历史"。
  - **已过时**：该条移入"历史"，可选填写"现在的情况"，填写即新增一条 claim。
  - **删除**：确认后移除，不进历史。
- 每节末尾一行浅色的"补充"，点击出现单行输入框，输入一句话回车即新增一条手动 claim 到该节。

正文之后依次是：

- **关系**：此人与其他人物的关系，每行"关系 · 人名链接"，带证据标记。末尾"补充关系"。
- **经历**：与此人相关的事件按时间倒序排列，每条"日期 · 事件摘要 · 其他参与者链接"。
- **历史**：被取代、被标记过时、被改写前的条目，默认折叠，展开后按时间倒序，每条注明何时因何失效。

### 9.6 证据标记的交互

所有带证据的内容（claim、别名、关系、日期、事件）共用同一个组件。

- 点击上标序号，在该行下方原地展开证据块，再次点击收起。不打开侧边栏，不跳转。
- 证据块显示证据消息及前后各 2 条消息，形式为"时间 · 发送者 · 正文"，证据消息加底色。多条证据时逐段排列，每段之间注明聊天名。
- 证据块底部两个链接："在聊天中查看"跳转到聊天原文页并定位；手动添加的条目在此处显示"手动添加于某日"。
- 语音、转账、红包在证据中显示为灰色标签（"语音 14 秒"），不隐藏。

### 9.7 导入浮层

唤起方式：点击顶栏"导入"；或把 ZIP 文件拖到任意页面，页面整体出现一层浅色遮罩和"松开以导入"提示。

浮层居中，宽度约 640px，三步，顶部显示步骤进度。

**第一步 预览**

- 浏览器端解压和解析，期间显示解析进度。
- 完成后显示：消息数、时间范围、发送者及各自条数、消息类型分布、图片数量与体积、视频数量与体积。
- 附件区：图片默认勾选，视频默认不勾选，可逐项调整。
- 已导入过的同一文件：提示"这份文件已经导入过"，给出链接到当时的导入结果页，不能继续。
- 解析失败：显示"无法识别这个文件"，附一句说明支持的格式（微信"转发到其他应用"导出的 ZIP）。

**第二步 这是谁的聊天**

- **聊天**：系统根据发送者显示名推荐已有聊天，推荐项排在最前；或"新建聊天"，填写名称并选择私聊或群聊。只有两个发送者时预选私聊。
- **发送者**：每个显示名一行，右侧是选择器，选项依次为：我、系统推荐的已有人物（附匹配理由，如"在『装修群』中也叫这个名字"）、搜索其他人物、新建人物。
- 设置中登记过的我的显示名自动选为"我"。
- 所有发送者都有选择后，"开始"按钮可用。

**第三步 开始**

点击"开始"后浮层关闭，进入导入结果页。上传与抽取在结果页上继续进行。

### 9.8 搜索浮层

唤起方式：点击首页搜索框或顶栏搜索入口；快捷键 `⌘K` / `Ctrl K`；在非输入状态下按 `/`。

- 输入即搜。结果分两组：
  - **人物**：匹配 label 与所有别名。每行人名，匹配的是别名时注明"又名 容尹"。
  - **信息**：匹配已确认 claim 的正文，如搜"汉中"找到"在汉中读高中"。每行"人名 · 匹配的那句话"，关键字高亮。
- 上下键选择，回车进入人物页；选中信息类结果时，进入人物页并滚动到该条、短暂高亮。
- 无结果时显示"没有找到"，下方一行"新建人物『输入内容』"。

### 9.9 导入结果页 `/imports/:id`

页面标题"这份聊天记录带来的变化"，副标题"聊天名 · 时间范围 · 新增 N 条消息"。

**进度**

- 抽取进行中时，标题下方一条细进度条和"正在读取 3 / 8 段对话"。
- 页面保持打开时，前端依次调用处理端点推进任务；已完成窗口的结果逐步出现在下方，新出现的条目有一次淡入。
- 用户可以离开页面。回来后从断点继续。离开期间任务不推进，页面上注明"离开页面后会暂停"。

**主体**

按人物分组，每人一节。节标题为人名链接，新人物标题后注明"新"。节的排列顺序：新人物在前，其余按新增条目数由多到少。

每节内分组，没有内容的组不显示：

- **新人物**：label 可直接修改；"其实是……"按钮打开人物选择器，选中后此人合并到已有人物，本节条目随之归并到对方名下。
- **新信息**：新增的 claim，按类别排列。
- **变化**：左右两栏并排，左侧为原有说法（灰），右侧为新说法，中间一个箭头。确认即右侧取代左侧。
- **别名与关系**：新发现的别名、新发现的关系。
- **日期**。

每一条都带证据标记（交互同 9.6）和三个操作：**确认**、**不对**、**改写**（原地编辑，保存即以改写后的内容确认）。已处理的条目变为已确认或划掉的样式，留在原位，不从页面消失，便于回看这次导入的全部结果。

批量操作：每节标题右侧"本节全部确认"；页面顶部"确认所有可信度高的条目"，点击后先显示将被确认的条数，再次点击执行。

**结束**

- 所有条目处理完，页面底部显示"已全部处理"，并列出本次涉及的人物链接。
- 没有处理完就离开，不做任何提示。未处理的条目保留在各自人物页中，以未确认样式显示。
- 抽取没有产出任何条目时，显示"这段聊天里没有找到需要记下来的信息"。

### 9.10 聊天原文页 `/chats/:id`

- 只读消息流，样式接近聊天记录而非聊天软件：左对齐，每条"时间 · 发送者 · 正文"，同一发送者连续消息合并显示时间。
- 从证据跳转进来时，滚动到目标消息并加底色。
- 发送者名显示为其人物 label 并链接到人物页；未关联人物的显示原始显示名。
- 顶部：聊天名、类型、参与者链接、导入记录（每次导入的时间范围，链接到导入结果页）。
- 顶部右侧"导入新的记录"，唤起导入浮层并预选此聊天。
- 附件：图片显示缩略图，点击放大；未上传或缺失的显示灰色占位"图片未导入"。

### 9.11 设置 `/settings`

单页，分节：

- **我**：我在微信里的显示名，可添加多个。
- **抽取**：模型选择；"高可信度"的阈值（默认 0.8），决定导入结果页批量确认的范围。
- **数据**：导出全部数据为 JSON；删除全部数据（需输入确认文字）。
- **账户**：修改密码、退出。

### 9.12 首次使用

- 注册后首先进入一个单页引导：填写"我在微信里的显示名"，说明可以跳过。
- 然后进入首页的空状态：搜索框位置换成一块大的拖放区域，文字说明如何从微信导出聊天记录（在聊天中多选消息 → 转发 → 其他应用 → 选择本应用或保存到文件），下方一个"选择文件"按钮。
- 完成第一次导入后，首页恢复正常结构。

### 9.13 窄屏

- 人物页信息框移到标题下方，默认折叠为两行摘要，点击展开。
- 导入浮层变为全屏。
- 导入结果页"变化"组由左右两栏改为上下排列。
- 顶栏搜索入口收为图标。

## 10. API 概览（Hono）

```
POST   /api/auth/*                         Better Auth
POST   /api/imports                        创建导入（解析结果）
PUT    /api/imports/:id/attachments/:name  上传附件
GET    /api/imports/:id                    导入详情与进度
POST   /api/imports/:id/mapping            提交聊天与发送者映射
POST   /api/imports/:id/jobs/next          处理下一个抽取窗口
GET    /api/imports/:id/review             按人物分组的待审阅条目
DELETE /api/imports/:id
GET    /api/people?index=pinyin
GET    /api/people/:id                     档案聚合数据
PATCH  /api/people/:id
POST   /api/people/:id/merge               { intoId }
POST   /api/people/:id/split               { handleId }
POST   /api/review/:type/:id               { action, patch? }
POST   /api/review/bulk                    { items[], action }
POST   /api/people/:id/claims|dates|relations|events   手动添加
GET    /api/chats, /api/chats/:id/messages?around=&personId=
GET    /api/evidence/:type/:id             证据消息及上下文
GET    /api/home
GET    /api/search?q=
GET    /api/export
```

所有路由经 Better Auth session 中间件，查询一律带 ownerId 条件。

## 11. 里程碑

**M0 脚手架。** Next.js + OpenNext Cloudflare 本地跑通；D1、R2 绑定在 `next dev` 下可用；Better Auth 注册登录；Hono 挂载并有一个受保护的 `/api/me`；Drizzle schema 与首个迁移；shadcn/ui 基础布局与侧边导航。验收：本地注册、登录、刷新后仍登录、未登录访问 `/people` 跳转登录页。

**M1 解析与导入。** `lib/wechat-export` 解析器与单元测试（合成样本覆盖多行正文、正文以 `·` 开头、空文件名图片、未知类型、同分钟重复短消息）；导入浮层三步与全局拖放；消息去重对齐；附件上 R2；聊天页只读消息流。验收：3 份真实样本导入后消息数与人工核对一致；同一 ZIP 重复导入被拒；构造部分重叠的导出，导入后无重复消息。

**M2 抽取与导入结果页。** LLM 适配器、提示词 v1、分窗、任务处理端点、zod 校验、判重、supersede；导入结果页全部交互与证据展开。验收：3 份样本抽取完成，结果页按人物分组，确认、拒绝、编辑、批量确认可用，确认后状态正确落库。

**M3 人物。** 人物页（信息框、分节正文、未确认条目原地确认、改写与过时、历史、补充）、搜索浮层、合并与拆分、删除语义。验收：搜别名找到人；搜 claim 正文定位到对应条目；合并后两人的 handles、claims、证据归到一人；拆出 handle 后该 handle 相关证据的归属可重新处理。

**M4 首页与设置。** 首页各区块与拼音索引、农历日期换算、首次使用引导与空状态、设置页、数据导出、窄屏适配。

**M5 评测。** 对真实样本人工标注金标准，脚本计算各类条目精确率、召回率、每 100 条消息产出数，错误分为事实错误、归错人、过度推断、应忽略却记录、敏感信息泄漏。提示词每次修改都跑一遍，结果记入 `eval/reports/`。

**M6 部署。** `wrangler d1 create`、`r2 bucket create`、远程迁移、环境变量、`opennextjs-cloudflare deploy`。验收：线上完成一次完整导入与审阅。

## 12. 待讨论

- **人物档案的类别体系。** 现有 7 个 category 是否够用，是否要为中国语境单列"家乡""孩子""饮食忌口"。
- **群聊显示名规则。** 需要一份有人设置了群昵称的群来验证 `display_group` 的稳定性。
- **隐私边界。** v1 部署在 Cloudflare 意味着消息存在 D1、经过 Anthropic API。自用可接受；如果以后给别人用，需要重新设计为本地处理或端侧模型。
