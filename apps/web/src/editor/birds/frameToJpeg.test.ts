import { describe, expect, it } from 'vitest'
import { fitLongEdge } from './frameToJpeg'

describe('fitLongEdge', () => {
  it('shrinks a landscape frame to the target on its long side', () => {
    expect(fitLongEdge(6000, 4000, 1024)).toEqual({ width: 1024, height: 683 })
  })

  it('shrinks a portrait frame on its long side too', () => {
    expect(fitLongEdge(4000, 6000, 1024)).toEqual({ width: 683, height: 1024 })
  })

  it('leaves an already-small frame alone', () => {
    // Upscaling invents no plumage for the classifier and only inflates the POST.
    expect(fitLongEdge(800, 600, 1024)).toEqual({ width: 800, height: 600 })
  })

  it('keeps the aspect ratio of a square frame', () => {
    expect(fitLongEdge(3000, 3000, 1024)).toEqual({ width: 1024, height: 1024 })
  })

  it('never returns a zero side on an extreme panorama', () => {
    // 12000×200 scaled to 1024 wants a height of 17.07 — rounding down a very
    // thin frame to 0 would produce a canvas that cannot be encoded.
    const size = fitLongEdge(12000, 200, 1024)
    expect(size.width).toBe(1024)
    expect(size.height).toBeGreaterThanOrEqual(1)
  })

  it('survives a degenerate size instead of dividing by zero', () => {
    expect(fitLongEdge(0, 0, 1024)).toEqual({ width: 1, height: 1 })
  })
})
