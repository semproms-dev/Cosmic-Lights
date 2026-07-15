import type { MaskAlpha } from './types'

/**
 * A decoded image with interleaved channels, described structurally so this
 * module never imports transformers.js. `RawImage` satisfies it, but keeping the
 * inference library out of here is what makes these helpers unit-testable.
 */
export interface ChannelImage {
  readonly data: Uint8Array | Uint8ClampedArray
  readonly width: number
  readonly height: number
  readonly channels: number
}

/**
 * Longest edge, in pixels, of the image handed to the segmentation model.
 *
 * The pipeline returns its mask at *input* resolution, so feeding it a 24 MP RAW
 * would allocate ~96 MB of RGBA just to throw 3 of every 4 bytes away. The model
 * works at ~1024² internally anyway, and the shader samples the mask with
 * normalised UVs and LINEAR filtering, so a smaller alpha stretches to the image
 * for free.
 */
export const MAX_INFERENCE_SIZE = 1024

/**
 * Scales `width`×`height` down so its longest edge is at most `max`, preserving
 * aspect ratio. Images already within the limit are returned unchanged — never
 * upscaled, which would only buy inference time for invented detail.
 *
 * @param width - Source width in pixels.
 * @param height - Source height in pixels.
 * @param max - Longest allowed edge. Defaults to {@link MAX_INFERENCE_SIZE}.
 * @returns The fitted size, each edge at least 1px.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_INFERENCE_SIZE,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) {
    return { width: Math.max(1, width), height: Math.max(1, height) }
  }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Flattens a segmentation result to the one-byte-per-pixel weight map the mask
 * pipeline speaks.
 *
 * The `background-removal` pipeline returns RGBA where the subject lives in the
 * alpha channel (255 = subject, 0 = background); a plain segmentation model may
 * instead return a single-channel mask. Both are handled, since the alpha is
 * always the *last* channel when there is one.
 *
 * @param image - The model output.
 * @returns The weight map at the image's own resolution.
 * @throws If the channel layout has no alpha (e.g. RGB) or `data` is too short.
 */
export function extractAlphaChannel(image: ChannelImage): MaskAlpha {
  const { data, width, height, channels } = image
  if (channels !== 1 && channels !== 2 && channels !== 4) {
    throw new Error(`Cannot extract a mask weight from a ${channels}-channel image`)
  }
  const pixels = width * height
  if (data.length < pixels * channels) {
    throw new Error(
      `Image data is too short: got ${data.length}, expected ${pixels * channels}`,
    )
  }

  const alpha = new Uint8Array(pixels)
  // Single-channel output *is* the weight; otherwise the weight is the alpha,
  // which is the last channel of each pixel.
  const stride = channels
  const offset = channels - 1
  for (let index = 0; index < pixels; index++) {
    alpha[index] = data[index * stride + offset]
  }
  return { data: alpha, width, height }
}
