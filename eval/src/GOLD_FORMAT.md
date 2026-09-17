# Gold file format (`eval/gold/<source>/<zip file name>.json`, e.g. `聊天记录_20260101_120000.zip.json`; `<name without .zip>.json` is also accepted)

Binding schema: `eval/src/gold-schema.ts` (zod, `GoldFileSchema`). Architecture: ARCHITECTURE.md §7.2 and §7.6.
Annotation rules come from SPEC §8.7. Gold is written only by the annotator. Nobody edits it to raise scores.

All example values below are invented for this document (a neighbourhood badminton club). They do not come from any
chat in `fixtures/`; do not copy them into gold.

## Workflow

1. `pnpm eval:annotate-view <zip> [--source synthetic|real]` writes `.dev/annotate/<source>/<name>.txt`, one line per message:
   `idx<TAB>sentAt<TAB>senderName<TAB>kind<TAB>body`, where `\n` inside a body is escaped. `idx` is the number every gold
   reference uses.
2. `pnpm eval:gold-template <zip> --source …` writes the skeleton: parserVersion, messageCount, messagesSha256, anchors,
   and senders with empty person keys. It never overwrites an existing file.
3. Fill in the file by hand.
4. `pnpm eval:validate-gold [--source …] [--zip …]` must report 0 errors.
5. `pnpm eval:freeze-gold --source … [--zip …]` appends a version to `eval/gold/LOCK.json`.
6. Changing gold after freeze is allowed only when the gold itself is wrong. First add
   `gold-change: <lockKey> <first 12 hex of the new gold sha256> <reason>` under `## annotator` in `docs/DECISIONS.md`,
   then run freeze-gold again. The lockKey is the zip name without `.zip` for synthetic and `real-<16 hex>` for real;
   validate-gold prints it.

## Top level

| field | type | notes |
|---|---|---|
| `goldVersion` | `1` \| `2` | `2` adds the optional `loops` / `conversations` arrays; the template writes `2`. A `1` file stays valid forever and scores exactly as it did. |
| `zip` | string | ZIP file name **including** `.zip`, no directory |
| `annotator` | string | agent role id (e.g. `annotator`); never a real name |
| `annotatedAt` | ISO string | |
| `notes` | string? | free text |
| `parserVersion`, `messageCount`, `messagesSha256`, `anchors` | from the template | drift guard; do not edit |
| `mapping` | object | see below |
| `persons` | array | everyone that any item refers to |
| `handles`, `relations`, `claims`, `dates`, `events` | arrays | expected pipeline output |
| `loops`, `conversations` | arrays? | goldVersion 2 only; **leaving the key out means "I did not annotate this type"**, which is not the same as `[]` |
| `negatives` | array | things that must **not** be recorded |
| `sensitiveValues` | string[] | literal strings that must never appear in output text |

Every item has a unique `id` (unique across all arrays in the file) and `evidence: number[]` (≥ 1 message idx, each in
`[0, messageCount)`). Items with `optional: true` count as correct when predicted, but missing them does not lower recall.
Use `optional` for facts that are true but borderline under SPEC §8.7 (e.g. weakly implied, or of doubtful value a month later).

## `mapping` — only what a user would enter in import step 2

```json
{ "chat": { "title": "周三羽毛球", "kind": "group" },
  "senders": [{ "senderName": "<exact display name>", "person": "p1" }],
  "self": "p0" }
```
- `senders` lists every sender display name in the export exactly once.
- `self` is the person key of the user's own sender.
- `chat.title` is a name a user would type. It must not be a `persons[].label` unless that label equals a sender name
  (validate-gold enforces this). The pipeline sees only the title, the kind and the sender names; labels, aliases and
  items never reach the prompt.

## `persons`

```json
{ "key": "p1", "label": "孟教练", "aliases": ["孟指导", "阿岚"], "inChat": true }
```
- `key`: `p1`, `p2` … for real data; short slugs are fine for synthetic data.
- `label`: the best name for this person. `aliases`: other names the chat uses for them. Both are used to recognise a
  person the pipeline creates (`new:<label>`); matching ignores spaces, width and case.
  A created person whose name is the label or an alias of a **sender** person is scored as a duplicate of that
  sender (all its items are false positives), so list every name a sender goes by under that sender.
- `inChat`: true when the person is a sender in this export.

## `handles` (kinds: `mentioned` | `real_name` | `address_term`)

```json
{ "id": "h1", "person": "p1", "kind": "mentioned", "value": "孟指导", "evidence": [12] }
```
Sender display names are not handles: the mapping creates those. A match needs the same person and an equal value after
normalisation. `kind` does not have to match (a mismatch is only reported).

## `relations`

```json
{ "id": "r1", "from": "p2", "to": "p3", "type": "parent", "label": "外公", "acceptTypes": ["relative"], "evidence": [40] }
```
- **Direction: `from` is the `type` of `to`.** "p2 is p3's parent" is `from: p2, to: p3, type: parent`.
- `type` vocabulary: `parent|child|spouse|sibling|relative|friend|colleague|classmate|service_provider|client|other`.
  `label` holds the Chinese term, if any.
- Matching accepts the reverse direction with the inverse type (`parent` ↔ `child`). Symmetric types
  (`spouse|sibling|friend|colleague|classmate|relative`) match in either direction. `acceptTypes` lists other types you
  would also accept.
- An address term used by one person toward another is direct evidence for a relation. A remark that merely mentions
  someone's family member (SPEC §3 has an example) is not.

## `claims`

```json
{ "id": "c3", "person": "p1", "statement": "在青岚体育馆做羽毛球教练", "category": "work",
  "acceptCategories": ["other"], "sensitive": false, "evidence": [51, 52], "supersedes": "c1" }
```
- One fact per claim, written the way the person page would show it (no subject, no trailing 。).
- `category`: `work|location|education|family|preference|life_event|other`. `acceptCategories` is optional; category is
  reported, not required for a match.
- A predicted claim matches if it states the same fact (`same`). A vaguer but true version is `less_specific`: it counts
  for precision, but recall counts only `same`.
- Sensitive content (phone, ID number, detailed address, bank info) never goes into `statement`. Write e.g.
  "提供过联系方式" with `sensitive: true`, and put the literal values into `sensitiveValues` and a `sensitive` negative.
- `supersedes`: the id of an earlier gold claim in this file that this one replaces (a job change, a move).

## `dates`

```json
{ "id": "d1", "person": "p4", "kind": "birthday", "month": 3, "day": 15, "calendar": "lunar", "evidence": [88] }
```
A match needs the same person, kind and calendar, plus month and day wherever gold has them. `year` and `isLeapMonth` are
optional. `kind`: `birthday|anniversary|memorial|other`.

## `events` (reported, not gated)

```json
{ "id": "e1", "summary": "球队去青岚湖露营", "participants": ["p0", "p2"], "evidence": [120] }
```

## `loops` — 未结事项 (goldVersion 2, SPEC §7 交互层)

A loop is something that is still open between you and one other person: a promise, an unanswered question, or a
plan that has not happened yet. Only what the messages actually say out loud — never "they probably meant to".

```json
{ "id": "k1", "person": "p2", "direction": "theirs", "kind": "promise",
  "text": "把球衣尺码发过来", "dueAt": "2026-05", "evidence": [140],
  "closedBy": 178, "closedReason": "done" }
```

| field | notes |
|---|---|
| `person` | the **other** person the loop is with (never `self`) |
| `kind` | `promise` (someone committed) \| `question` (asked, not answered) \| `plan` (agreed, not happened) |
| `direction` | who has to move next, seen from the user: `mine` = the user owes the action or the answer, `theirs` = the other person does, `mutual` = both agreed to it together. So a question **they** asked and the user never answered is `question` + `mine`. |
| `text` | the thing itself, **without a subject** ("把球衣尺码发过来"). The interface builds the sentence from `kind` + `direction`. |
| `dueAt` | `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, only when the messages give one |
| `evidence` | the message(s) that **open** it |
| `closedBy` | idx of the message that closes it, when this export contains one; must come after the opening message |
| `closedReason` | `done` (it happened / was answered) or `dropped` (explicitly cancelled). Only with `closedBy`. |

Scoring: a prediction matches when it is about the same person and the judge calls the two `text`s the same fact.
A wrong `kind` or `direction` on a matched pair is **reported, not counted against the run**. `closedBy` is scored
separately (`loopCloseRecall`): the run has to close the loop at that exact idx.

## `conversations` (goldVersion 2, SPEC §7 交互层)

One stretch of chat that hangs together — segments less than 3 hours apart. Conversations are never stored by the
app; they are regrouped on every read, so gold only needs the span and the topics a decent summary has to mention.

```json
{ "id": "v1", "startIdx": 120, "endIdx": 148, "topics": ["露营", "借帐篷"] }
```

Spans must not overlap each other. A prediction matches when it covers at least half of the gold span; its summary
is then scored only on how many of the `topics` strings appear in it (substring, whitespace and case ignored). Pick
topic words a one-sentence summary would naturally contain, and two or three of them, not ten.

## `negatives`

```json
{ "id": "n4", "kind": "transactional", "evidence": [60, 61], "description": "场地租金明细", "forbidden": "任何金额进入 claim" }
```
`kind`:
- `transactional`: quotes, prices, fees, schedules, files, accounts (SPEC §8.7 gives examples).
- `coordination`: arrival and waiting notices, meeting times and places.
- `inference_trap`: text that tempts an inference the text does not support.
- `sensitive`: phone, ID or bank numbers, detailed addresses.
- `invisible_content`: voice, transfer, red packet (content or amount not visible).

The eval judge uses negatives to classify false positives, and `transactional` + `coordination` feed the
transactional-as-claim gate. List the clear cases; the judge also recognises unlisted transactional claims.

## `sensitiveValues`

Exact strings as they appear in the chat, e.g. `["15000009876", "枫林街5号2栋302"]`. Required when any negative has kind
`sensitive`. Matching ignores whitespace. For real data this file is gitignored, so real values are allowed here and
nowhere else.
