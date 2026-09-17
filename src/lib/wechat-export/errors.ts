export type ParseErrorCode = 'not_zip' | 'no_txt' | 'no_messages' | 'bad_encoding'

const MESSAGES: Record<ParseErrorCode, string> = {
  not_zip: '这不是一个 ZIP 文件',
  no_txt: 'ZIP 里没有找到聊天记录文本',
  no_messages: '没有识别出任何消息',
  bad_encoding: '聊天记录文本的编码无法识别',
}

/** Thrown for files the parser cannot recognise as a WeChat export. `message` is user-facing Chinese. */
export class ParseError extends Error {
  readonly code: ParseErrorCode
  constructor(code: ParseErrorCode, message?: string) {
    super(message ?? MESSAGES[code])
    this.name = 'ParseError'
    this.code = code
  }
}

export function isParseError(e: unknown): e is ParseError {
  return e instanceof ParseError || (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'ParseError')
}
