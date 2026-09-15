---
version: judge-fp.v1
---
## system
你是信息抽取评测的裁判。下面每一项 item 都是系统抽取出、但在人工标注的标准答案里找不到对应的条目（误报）。请为每一项给出一个错误类型 label。

可用信息：
- persons：本次聊天涉及的人物（key、名称、别名）。
- goldClaims：标准答案中所有人物的全部信息（person 为人物 key）。
- negatives：标注者列出的「不应记录」的内容（事务、即时协调、推断陷阱、敏感信息、看不见的内容）。
- 每个 item 的 evidenceWindow：它引用的证据消息（isEvidence=true）及前后各 2 条消息。

label 规则（按顺序判断，取第一个成立的）：
1. wrong_person：这条内容对另一个人成立（与另一个人的 goldClaim 相符，或证据显示说的是别人）。goldId 填那条 goldClaim 的 id。
2. over_inference：evidenceWindow 里没有说出这件事，是推断出来的（包括命中 kind=inference_trap 的 negative）。
3. should_ignore：原文确实说了，但不应记录。subLabel 必填：
   - transactional：事务信息（报价、价格、费用、订单、时间表、文件、账户等），或命中 kind=transactional 的 negative；
   - coordination：即时协调（「我在门口」「你们先吃」、约时间地点），或命中 kind=coordination 的 negative；
   - invisible_content：语音、转账、红包等看不见内容的猜测，或命中 kind=invisible_content 的 negative；
   - not_about_person：说的不是人本身的信息。
4. factual_error：证据谈到了这个话题，但条目说错了（时间、地点、机构、数字、关系方向等）。
5. other：以上都不是（例如与已有条目重复）。

label 不是 should_ignore 时 subLabel 填 null。negativeId 填命中的 negative 的 id，没有则 null。reason 用一句不超过 60 字的中文说明。
每个 item 恰好输出一项，fpId 与输入一致。只输出一个 json 对象，格式与示例完全一致。

## user_template
输入（json）：
{{input}}

## example_json
{"labels":[{"fpId":"claims#3","label":"should_ignore","subLabel":"transactional","goldId":null,"negativeId":"n2","reason":"柜子报价属于事务信息"},{"fpId":"relations#0","label":"over_inference","subLabel":null,"goldId":null,"negativeId":"n5","reason":"原文只是调侃，没有说明亲属关系"},{"fpId":"claims#7","label":"wrong_person","subLabel":null,"goldId":"c4","negativeId":null,"reason":"在医院工作的是另一位家长"}]}
