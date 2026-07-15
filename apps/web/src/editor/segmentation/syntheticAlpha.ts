import type { MaskAlpha } from './types'

/**
 * Builds a filled circle as a weight map: a stand-in for a real segmentation.
 *
 * It exists to test the GPU half of the AI-mask pipeline — upload, orientation,
 * channel, the `syncMasks` retry — without a model, a download or a network. A
 * circle is a deliberate choice: it is off-centre-safe (any vertical flip is
 * invisible on a centred circle, so it is placed slightly high) and its edge is
 * soft, which makes filtering problems obvious.
 *
 * @param width - Weight map width in pixels.
 * @param height - Weight map height in pixels.
 * @returns The weight map, 255 inside the circle and 0 outside.
 */
export function createCircleAlpha(width: number, height: number): MaskAlpha {
  const data = new Uint8Array(width * height)
  const centreX = width / 2
  // Deliberately above centre: a centred circle would look identical upside
  // down and hide a Y-flip bug.
  const centreY = height * 0.4
  const radius = Math.min(width, height) * 0.25
  // Feather the last pixel or so of the edge, so LINEAR sampling has something
  // to interpolate and a hard aliased rim does not read as a bug.
  const feather = Math.max(1, radius * 0.05)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x + 0.5 - centreX, y + 0.5 - centreY)
      // 1 well inside, 0 well outside, a linear ramp across the feather band.
      const weight = Math.min(1, Math.max(0, (radius - distance) / feather + 0.5))
      data[y * width + x] = Math.round(weight * 255)
    }
  }
  return { data, width, height }
}
