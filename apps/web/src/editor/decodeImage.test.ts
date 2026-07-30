import type { Metadata } from 'libraw-wasm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeImage } from './decodeImage'
import { decodeRaw } from './decodeRaw'
import { readJpegMetadata } from './jpegMetadata'

vi.mock('./decodeRaw', () => ({ decodeRaw: vi.fn() }))
vi.mock('./jpegMetadata', () => ({ readJpegMetadata: vi.fn() }))

/**
 * jsdom ships no `ImageData`, and the RAW branch only ever hands it straight to
 * `createImageBitmap` — so a stand-in is enough, and it doubles as the marker
 * that tells the two branches apart in the stub below.
 */
class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

const RAW_BITMAP = { from: 'libraw' } as unknown as ImageBitmap
const BROWSER_BITMAP = { from: 'browser' } as unknown as ImageBitmap
const CAMERA_METADATA = { iso_speed: 3200 } as unknown as Metadata
const JPEG_EXIF = { iso_speed: 200 } as unknown as Metadata

/** First bytes of a real JPEG (SOI + APP0) and of a TIFF-based RAW. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])
const RAW_BYTES = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08])

/** A file whose name and whose content can be set independently — the point here. */
function fileNamed(name: string, bytes: Uint8Array): File {
  return new File([bytes], name)
}

/**
 * Stubs `createImageBitmap` for both branches. The RAW branch passes an
 * `ImageData` it built itself, the browser branch passes the `File`, so the
 * argument says which decoder is calling.
 *
 * @param browserAccepts - Whether the browser can decode the file, i.e. whether
 *   it is really a developed image.
 */
function stubDecoders(browserAccepts: boolean): ReturnType<typeof vi.fn> {
  const createImageBitmapMock = vi.fn(async (source: unknown) => {
    if (source instanceof FakeImageData) return RAW_BITMAP
    if (!browserAccepts) throw new Error('the source image cannot be decoded')
    return BROWSER_BITMAP
  })
  vi.stubGlobal('createImageBitmap', createImageBitmapMock)
  return createImageBitmapMock
}

beforeEach(() => {
  vi.stubGlobal('ImageData', FakeImageData)
  vi.mocked(decodeRaw).mockResolvedValue({
    data: new Uint8Array([10, 20, 30]),
    width: 1,
    height: 1,
    metadata: CAMERA_METADATA,
  })
  vi.mocked(readJpegMetadata).mockResolvedValue(JPEG_EXIF)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('decodeImage', () => {
  it('sends a RAW through libraw and keeps its camera metadata', async () => {
    stubDecoders(true)

    const decoded = await decodeImage(fileNamed('shot.nef', RAW_BYTES))

    expect(decoded.source).toBe('raw')
    expect(decoded.bitmap).toBe(RAW_BITMAP)
    expect(decoded.metadata).toBe(CAMERA_METADATA)
  })

  it('sends a developed file to the browser and reads its EXIF', async () => {
    stubDecoders(true)

    const decoded = await decodeImage(fileNamed('shot.jpg', JPEG_BYTES))

    expect(decoded.source).toBe('developed')
    expect(decoded.bitmap).toBe(BROWSER_BITMAP)
    expect(decoded.metadata).toBe(JPEG_EXIF)
  })

  it('never even offers libraw a JPEG wearing a RAW extension', async () => {
    // The signature settles it up front, so the mislabelled file costs no failed
    // decode at all — this is the case the whole check exists for.
    stubDecoders(true)

    const decoded = await decodeImage(fileNamed('renamed.nef', JPEG_BYTES))

    expect(decoded.source).toBe('developed')
    expect(decodeRaw).not.toHaveBeenCalled()
  })

  it('falls back to libraw for a RAW wearing a .jpg extension', async () => {
    // No signature table catches this direction — there is no single "RAW magic"
    // to test — so it is the failed browser decode that reveals the lie.
    stubDecoders(false)

    const decoded = await decodeImage(fileNamed('renamed.jpg', RAW_BYTES))

    expect(decoded.source).toBe('raw')
    expect(decoded.metadata).toBe(CAMERA_METADATA)
  })

  it('costs exactly one decode when the name tells the truth', async () => {
    // The fallback must stay free in the common case: the extension is right for
    // essentially every real file, and a wasted decode is expensive.
    const createImageBitmapMock = stubDecoders(true)

    await decodeImage(fileNamed('shot.jpg', JPEG_BYTES))

    expect(createImageBitmapMock).toHaveBeenCalledTimes(1)
    expect(decodeRaw).not.toHaveBeenCalled()
  })

  it('gives up only once both decoders have refused the file', async () => {
    stubDecoders(false)
    vi.mocked(decodeRaw).mockRejectedValue(new Error('libraw: unrecognised file'))

    await expect(decodeImage(fileNamed('broken.nef', RAW_BYTES))).rejects.toThrow()
    // Both were tried before the error surfaced; a file is only unopenable when
    // neither wants it.
    expect(decodeRaw).toHaveBeenCalled()
  })

  it('still decodes a file whose header cannot be read', async () => {
    // An unreadable header must not become a second failure mode of its own: the
    // extension simply stays in charge, as it was before the check existed.
    stubDecoders(true)
    const unreadable = fileNamed('shot.nef', RAW_BYTES)
    vi.spyOn(unreadable, 'slice').mockImplementation(() => {
      throw new Error('permission denied')
    })

    const decoded = await decodeImage(unreadable)

    expect(decoded.source).toBe('raw')
  })
})
