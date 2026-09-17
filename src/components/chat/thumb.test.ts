import { describe, expect, it } from 'vitest'
import { downloadHref, TALL_RATIO, thumbFit, undecodableFormatLabel } from './thumb'

describe('thumbFit', () => {
  it('anchors tall phone screenshots to the top', () => {
    expect(thumbFit(1280, 2800)).toBe('top')
    expect(thumbFit(1080, 2340)).toBe('top')
    expect(thumbFit(750, 12000)).toBe('top') // long scrolling screenshot
  })

  it('keeps the centre crop for photos, square and wide images', () => {
    expect(thumbFit(4032, 3024)).toBe('center')
    expect(thumbFit(3024, 4032)).toBe('center') // portrait photo, 4:3
    expect(thumbFit(1000, 1000)).toBe('center')
    expect(thumbFit(1920, 600)).toBe('center')
  })

  it('uses a strict threshold', () => {
    expect(thumbFit(1000, 1000 * TALL_RATIO)).toBe('center')
    expect(thumbFit(1000, 1000 * TALL_RATIO + 1)).toBe('top')
  })

  it('falls back to centre before the image has loaded or when sizes are unusable', () => {
    expect(thumbFit(0, 0)).toBe('center')
    expect(thumbFit(0, 2800)).toBe('center')
    expect(thumbFit(Number.NaN, 2800)).toBe('center')
  })
})

describe('undecodableFormatLabel', () => {
  it('names HEIC/AVIF/TIFF from the served type, which wins over a .jpg name', () => {
    expect(undecodableFormatLabel('image/heic', '微信图片_202601011200_1.jpg')).toBe('HEIC')
    expect(undecodableFormatLabel('image/heif')).toBe('HEIC')
    expect(undecodableFormatLabel('image/avif; charset=binary')).toBe('AVIF')
    expect(undecodableFormatLabel('image/tiff')).toBe('TIFF')
  })

  it('falls back to the extension, and says nothing for ordinary types', () => {
    expect(undecodableFormatLabel(null, 'IMG_0001.HEIC')).toBe('HEIC')
    expect(undecodableFormatLabel('application/octet-stream', 'a.heif')).toBe('HEIC')
    expect(undecodableFormatLabel('image/jpeg', '微信图片_202601011200_1.jpg')).toBeNull()
    expect(undecodableFormatLabel(null, null)).toBeNull()
  })
})

describe('downloadHref', () => {
  it('asks the attachment stream for a download, leaves other URLs alone', () => {
    expect(downloadHref('/api/attachments/42')).toBe('/api/attachments/42?download=1')
    expect(downloadHref('data:image/heic;base64,AAAA')).toBe('data:image/heic;base64,AAAA')
  })
})
