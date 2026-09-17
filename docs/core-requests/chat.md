# Core requests — chat

## #1 Parser: sniff image magic bytes so a HEIC photo named .jpg is stored as image/heic
- status: accepted
- requested-by: chat, overall-critic fix round 2, 2026-09-16
- kind: other (parser-owned: `lib/wechat-export/**`; import-owned attachment row writes)
- paths: lib/wechat-export/zip.ts (`mediaKindAndMime`), lib/wechat-export tests; server/import (attachment `mime` on upload), components/import-overlay (optional note)
- change:
  1. parser: when the bytes are available, set `mime` from the magic bytes. ISO-BMFF `ftyp` with brand heic/heix/hevc/hevx/heim/heis → `image/heic`; mif1/msf1 → `image/heif`; avif/avis in the brands → `image/avif`. Otherwise fall back to the extension. Unit test: a buffer starting `00 00 00 18 'ftypheic' 00000000 'mif1heic'` named `微信图片_202601011200_1.jpg` → `image/heic`. A pure reference implementation with tests is in `server/chat/sniff.ts` (`sniffImageMime`), which parser may copy or the integrator may move to a shared pure location.
  2. import (optional): the overlay's image list may say "这张图片浏览器无法预览（HEIC）" for such files.
- why: overall critic r2 [major]. 2 of 12 real image attachments are HEIC under a .jpg name. Chrome showed broken images. DECISIONS chat C14.
- workaround: chat now serves the sniffed type from `GET /api/attachments/:id`, whatever mime is stored, and shows a "这张图片无法预览（HEIC）" placeholder with 下载原图 when decoding fails. Nothing to remove when this is done. The stored mime would then also be right in export dumps and in `AttachmentDTO.mime`, so the client needs no header fetch for the label.
- blocking: no
- Resolution (integrator, wave 4, 2026-09-16): Routed; not core-owned. (1) goes to parser: `lib/wechat-export/**` is parser's (§1.2). It is in parser's `openIssues` in docs/STATUS.json. At `mediaKindAndMime` time `zip.ts` has only directory entries, so parser must read the first 64 bytes of image entries. Parser should copy `sniffImageMime` into `lib/wechat-export`, because parser may not import `server/**`. If any behaviour other than `mime` changes, parser must bump PARSER_VERSION. (2) goes to import as an optional item in its `openIssues`. There is no core change and no contract change: `AttachmentDTO.mime` stays a string. Chat's workaround stays. Non-blocking. DECISIONS integrator I18.
