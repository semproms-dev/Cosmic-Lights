import { describe, expect, it } from 'vitest'
import { MAX_INFERENCE_SIZE, extractAlphaChannel, fitWithin, type ChannelImage } from './alpha'

describe('fitWithin', () => {
  it('leaves an image that already fits untouched', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('does not upscale a small image', () => {
    expect(fitWithin(64, 32)).toEqual({ width: 64, height: 32 })
  })

  it('scales a landscape image down to the limit on its longest edge', () => {
    expect(fitWithin(6000, 4000)).toEqual({ width: MAX_INFERENCE_SIZE, height: 683 })
  })

  it('scales a portrait image down to the limit on its longest edge', () => {
    expect(fitWithin(4000, 6000)).toEqual({ width: 683, height: MAX_INFERENCE_SIZE })
  })

  it('preserves the aspect ratio within a pixel', () => {
    const { width, height } = fitWithin(3000, 2000)
    expect(width / height).toBeCloseTo(1.5, 2)
  })

  it('honours a custom limit', () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ width: 100, height: 50 })
  })

  it('never returns a zero-sized edge for extreme aspect ratios', () => {
    const { width, height } = fitWithin(10000, 3, 1024)
    expect(width).toBe(1024)
    expect(height).toBe(1)
  })
})

describe('extractAlphaChannel', () => {
  it('takes the alpha channel of an RGBA image', () => {
    // 2×1 px: an opaque red pixel and a fully transparent one.
    const image: ChannelImage = {
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]),
      width: 2,
      height: 1,
      channels: 4,
    }
    const alpha = extractAlphaChannel(image)
    expect(Array.from(alpha.data)).toEqual([255, 0])
    expect(alpha.width).toBe(2)
    expect(alpha.height).toBe(1)
  })

  it('preserves partial weights instead of thresholding them', () => {
    const image: ChannelImage = {
      data: new Uint8ClampedArray([0, 0, 0, 128, 0, 0, 0, 64]),
      width: 2,
      height: 1,
      channels: 4,
    }
    expect(Array.from(extractAlphaChannel(image).data)).toEqual([128, 64])
  })

  it('uses the only channel of a single-channel mask', () => {
    const image: ChannelImage = {
      data: new Uint8Array([10, 20, 30, 40]),
      width: 2,
      height: 2,
      channels: 1,
    }
    expect(Array.from(extractAlphaChannel(image).data)).toEqual([10, 20, 30, 40])
  })

  it('takes the alpha channel of a grey+alpha image', () => {
    const image: ChannelImage = {
      data: new Uint8Array([99, 1, 99, 2]),
      width: 2,
      height: 1,
      channels: 2,
    }
    expect(Array.from(extractAlphaChannel(image).data)).toEqual([1, 2])
  })

  it('returns a Uint8Array of exactly one byte per pixel', () => {
    const image: ChannelImage = {
      data: new Uint8ClampedArray(4 * 4 * 4),
      width: 4,
      height: 4,
      channels: 4,
    }
    const alpha = extractAlphaChannel(image)
    expect(alpha.data).toBeInstanceOf(Uint8Array)
    expect(alpha.data.length).toBe(16)
  })

  it('rejects an RGB image, which carries no weight to extract', () => {
    const image: ChannelImage = {
      data: new Uint8Array([1, 2, 3]),
      width: 1,
      height: 1,
      channels: 3,
    }
    expect(() => extractAlphaChannel(image)).toThrow(/3-channel/)
  })

  it('rejects data shorter than the declared size', () => {
    const image: ChannelImage = {
      data: new Uint8Array([1, 2, 3, 4]),
      width: 10,
      height: 10,
      channels: 4,
    }
    expect(() => extractAlphaChannel(image)).toThrow(/too short/)
  })
})
