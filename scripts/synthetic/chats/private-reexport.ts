// Private chat between the user (小满) and a hiking friend (remark name 小棠), exported twice the way WeChat really does
// it: every image/video file is named by the EXPORT time (`微信图片_<export minute>_<n>.jpg`), so the same photo has a
// different file name in each export while its bytes stay the same (DECISIONS eval-synthetic E19). The overlap is full
// of photos and videos: a same-sender same-minute burst, photos from both senders in one minute, videos, a missing
// photo, an empty image name and a file. Import dedup (SPEC §8.4) must reuse every overlapping message.
// Not annotated and not scored (use: 'reexport'). All names are fictional; nothing here is a planted fact.
import { PRIVATE_POOL } from '../filler'
import { L, type ChatScript } from '../lib'

const M = 'M'
const T = 'T'

export const REEXPORT_FIRST = '聊天记录_20260611_213407.zip'
export const REEXPORT_SECOND = '聊天记录_20260915_081926.zip'

export const privateReexport: ChatScript = {
  id: 'private-reexport',
  use: 'reexport',
  title: '小棠',
  kind: 'private',
  speakers: { M: '小满', T: '小棠' },
  selfCode: M,
  members: [
    { key: 'xiaoman', label: '小满', displayName: '小满', note: 'self (the user)' },
    { key: 'xiaotang', label: '小棠', displayName: '小棠', note: 'hiking friend; remark name' },
  ],
  planted: [],
  negatives: [],
  sensitiveValues: [],
  scenes: [
    // ---- first export only
    {
      at: '2026-04-12 18:20',
      lines: [L(T, '{{img}}'), L(T, '今天爬的那座山，终于登顶'), L(M, '风景真好'), L(M, '下次叫上我')],
    },
    {
      at: '2026-05-03 11:05',
      lines: [L(M, '{{img}}'), L(M, '{{img}}', { dt: 0 }), L(M, '五一在老家拍的'), L(T, '油菜花好看')],
    },
    // ---- overlap of the two exports (2026-05-25 … 2026-06-11 21:34)
    {
      at: '2026-05-30 10:12',
      lines: [
        L(T, '{{img}}'),
        L(T, '{{img}}', { dt: 0 }),
        L(T, '{{img}}', { dt: 0 }),
        L(T, '{{img}}', { dt: 0 }),
        L(T, '露营第一天，全是照片哈哈', { dt: 0 }),
        L(M, '帐篷搭得不错'),
        L(M, '[强]'),
      ],
    },
    {
      at: '2026-06-02 19:40',
      lines: [L(T, '{{vid}}'), L(T, '晚上的篝火'), L(M, '{{img}}', { dt: 1 }), L(M, '我这边只有加班的工位[流泪]'), L(T, '辛苦了')],
    },
    {
      at: '2026-06-06 21:05',
      lines: [
        L(T, '{{img:missing}}'),
        L(M, '图片没显示出来'),
        L(T, '[图片]'),
        L(T, '算了，我发文件给你'),
        L(T, '[文件] 露营装备清单.xlsx'),
        L(M, '收到'),
      ],
    },
    {
      at: '2026-06-09 12:30',
      lines: [
        L(M, '{{img}}'),
        L(T, '{{img}}', { dt: 0 }),
        L(M, '午饭', { dt: 0 }),
        L(T, '我也在吃', { dt: 0 }),
        L(T, '{{vid}}', { dt: 1 }),
        L(T, '{{vid}}', { dt: 0 }),
        L(M, '食堂排队这么长'),
      ],
    },
    {
      at: '2026-06-11 20:48',
      lines: [L(T, '{{img}}'), L(T, '下周去的地方，看这张图'), L(M, '可以，周六出发？'), L(T, '好')],
    },
    // ---- second export only
    {
      at: '2026-06-20 09:30',
      lines: [L(T, '{{img}}'), L(T, '{{img}}', { dt: 0 }), L(T, '出发啦'), L(M, '注意安全')],
    },
    {
      at: '2026-08-16 17:10',
      lines: [L(M, '{{vid}}'), L(M, '海边的浪好大'), L(T, '羡慕'), L(T, '{{img}}'), L(T, '我这边在下雨')],
    },
  ],
  filler: { seed: 20260611, count: 28, from: '2026-03-01', to: '2026-09-14', pool: PRIVATE_POOL, speakers: [M, T], minRepeatGapDays: 30 },
  exports: [
    { file: REEXPORT_FIRST, from: '2026-03-01 00:00', to: '2026-06-11 21:34', purpose: '私聊，第一次导出', mediaNames: 'export-time' },
    { file: REEXPORT_SECOND, from: '2026-05-25 00:00', to: '2026-09-15 08:19', purpose: '私聊，第二次导出', mediaNames: 'export-time' },
  ],
}
