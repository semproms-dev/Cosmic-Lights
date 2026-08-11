import type { Metadata } from 'libraw-wasm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeRaw } from './decodeRaw'

/**
 * Hoisted so `vi.mock` — which runs before the module body — can close over the
 * same spies the tests assert on.
 */
const libraw = vi.hoisted(() => ({
  open: vi.fn<(bytes: Uint8Array, settings: Record<string, unknown>) => Promise<void>>(),
  metadata: vi.fn(),
  imageData: vi.fn(),
  dispose: vi.fn(),
}))

// A plain function, not an arrow: `decodeRaw` calls `new LibRaw()`, and an arrow
// cannot be constructed. Returning an object from a constructor hands that object
// back, so every test drives the same set of spies.
vi.mock('libraw-wasm', () => ({
  default: vi.fn(function LibRawMock() {
    return libraw
  }),
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const METADATA = { iso_speed: 100 } as unknown as Metadata

/** A decoded frame in the shape LibRaw hands back: 2x1 pixels, 3x8 bits. */
function frame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data: new Uint8Array([1, 2, 3, 4, 5, 6]),
    width: 2,
    height: 1,
    bits: 8,
    colors: 3,
    ...overrides,
  }
}

/** The settings object handed to LibRaw on the most recent `open`. */
function settingsUsed(): Record<string, unknown> {
  const call = libraw.open.mock.calls.at(-1)
  if (call === undefined) throw new Error('open was never called')
  return call[1]
}

beforeEach(() => {
  vi.clearAllMocks()
  libraw.open.mockResolvedValue(undefined)
  libraw.metadata.mockResolvedValue(METADATA)
  libraw.imageData.mockResolvedValue(frame())
})

describe('decodeRaw', () => {
  it('returns the pixels, the dimensions and the metadata', async () => {
    const decoded = await decodeRaw(new ArrayBuffer(8))

    expect(decoded.data).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect(decoded.metadata).toBe(METADATA)
  })

  it('decodes half-size with the camera white balance and no auto-brightening', async () => {
    await decodeRaw(new ArrayBuffer(8))

    expect(settingsUsed()).toMatchObject({
      halfSize: true,
      useCameraWb: true,
      noAutoBright: true,
    })
  })

  it('applies the baseline exposure in linear light, with the highlights preserved', async () => {
    await decodeRaw(new ArrayBuffer(8))
    const settings = settingsUsed()

    // The master switch, without which LibRaw silently ignores both fields, and
    // the calibrated multiplier — not a stops figure, since LibRaw's shift does
    // not convert to output stops through the 2.2 gamma one would assume.
    expect(settings.expCorrec).toBe(true)
    expect(settings.expShift).toBeCloseTo(2.85, 5)
    expect(settings.expPreser).toBe(1)
  })

  it('asks for no highlight mode, which would cost 1.5 stops of global brightness', async () => {
    await decodeRaw(new ArrayBuffer(8))

    expect(settingsUsed()).not.toHaveProperty('highlight')
  })

  it('throws when LibRaw hands back no image', async () => {
    libraw.imageData.mockResolvedValue(null)

    await expect(decodeRaw(new ArrayBuffer(8))).rejects.toThrow('libraw returned no data')
  })

  it('throws when the frame is not the 3x8 bits the rest of the pipeline assumes', async () => {
    libraw.imageData.mockResolvedValue(frame({ bits: 16 }))

    await expect(decodeRaw(new ArrayBuffer(8))).rejects.toThrow('unexpected decode format')
  })

  it('frees the WASM instance even when the decode fails', async () => {
    libraw.open.mockRejectedValue(new Error('not a raw file'))

    await expect(decodeRaw(new ArrayBuffer(8))).rejects.toThrow('not a raw file')
    expect(libraw.dispose).toHaveBeenCalledOnce()
  })
})
