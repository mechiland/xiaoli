import { describe, expect, it } from 'vitest'
import { EXAMPLE_EXPORT_FILE_NAME } from './format'

describe('EXAMPLE_EXPORT_FILE_NAME (parse-error notice)', () => {
  it('has the WeChat export shape', () => {
    expect(EXAMPLE_EXPORT_FILE_NAME).toMatch(/^聊天记录_\d{8}_\d{6}\.zip$/)
  })

  it('uses the synthetic placeholder stamp, not a sample export time', () => {
    // 2026-01-01 12:00:00 is a round placeholder no real or synthetic fixture uses; matches the empty-home drop zone.
    expect(EXAMPLE_EXPORT_FILE_NAME).toBe('聊天记录_20260101_120000.zip')
  })
})
