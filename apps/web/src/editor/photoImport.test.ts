import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPhoto, enrichPhoto, generateThumbnail, readCaptureTime } from './photoImport'

// The EXIF reader is the one dependency with real parsing behind it; the tests
// decide per case what a file "contains".
vi.mock('./jpegMetadata', () => ({
  readJpegMetadata: vi.fn(),
}))

import { readJpegMetadata } from './jpegMetadata'
import type { Metadata } from 'libraw-wasm'

const mockRead = vi.mocked(readJpegMetadata)

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('createPhoto', () => {
  it('registers the file name and leaves enrichment fields open', () => {
    const photo = createPhoto(new File([], 'IMG_0001.RAF'))
    expect(photo.fileName).toBe('IMG_0001.RAF')
    expect(photo.thumbUrl).toBeNull()
    expect(photo.captureTime).toBeNull()
  })

  it('gives every photo a unique id', () => {
    const a = createPhoto(new File([], 'a.jpg'))
    const b = createPhoto(new File([], 'b.jpg'))
    expect(a.id).not.toBe(b.id)
  })
})

describe('generateThumbnail', () => {
  it('returns null when the platform cannot decode images', () => {
    // jsdom has no `createImageBitmap`: the guard must catch it before any call.
    expect(typeof createImageBitmap).toBe('undefined')
    return expect(generateThumbnail(new File([], 'a.jpg'))).resolves.toBeNull()
  })

  it('swallows decode failures — RAW files are expected to fail here', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unknown format')))
    await expect(generateThumbnail(new File([], 'IMG.RAF'))).resolves.toBeNull()
  })
})

describe('thumbnailFromBitmap coverage via generateThumbnail', () => {
  it('yields null when no 2D context exists (jsdom canvas)', async () => {
    // A resolved bitmap reaches `thumbnailFromBitmap`, whose getContext returns
    // null under jsdom — the guard, not a crash.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }),
    )
    await expect(generateThumbnail(new File([], 'a.jpg'))).resolves.toBeNull()
  })
})

describe('readCaptureTime', () => {
  it('reads the EXIF timestamp in epoch milliseconds', async () => {
    const when = new Date(2024, 6, 10, 14, 30, 5)
    mockRead.mockResolvedValue({ timestamp: when } as unknown as Metadata)
    await expect(readCaptureTime(new File([], 'a.jpg'))).resolves.toBe(when.getTime())
  })

  it('returns null for files without metadata', async () => {
    mockRead.mockResolvedValue(null)
    await expect(readCaptureTime(new File([], 'a.jpg'))).resolves.toBeNull()
  })

  it('rejects unusable timestamps rather than inventing one', async () => {
    mockRead.mockResolvedValue({ timestamp: new Date(NaN) } as unknown as Metadata)
    await expect(readCaptureTime(new File([], 'a.jpg'))).resolves.toBeNull()
  })
})

describe('enrichPhoto', () => {
  it('combines both reads', async () => {
    const when = new Date(2024, 0, 1)
    mockRead.mockResolvedValue({ timestamp: when } as unknown as Metadata)
    const enrichment = await enrichPhoto(new File([], 'a.jpg'))
    // jsdom produces no thumbnail; the capture time still lands.
    expect(enrichment).toEqual({ thumbUrl: null, captureTime: when.getTime() })
  })
})
