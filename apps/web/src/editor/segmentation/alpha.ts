import type { MaskAlpha, MaskGranularity } from './types'

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

/**
 * Picks the highest-scoring of SAM's candidate masks.
 *
 * SAM answers each prompt with several masks (typically three: roughly "part",
 * "whole", "everything") plus an IoU confidence for each. The most confident is
 * the sensible default when the user gave no other cue.
 *
 * @param iouScores - One confidence per candidate mask.
 * @returns The index of the best mask, or 0 if the list is empty.
 */
export function bestMaskIndex(iouScores: ArrayLike<number>): number {
  let best = 0
  for (let index = 1; index < iouScores.length; index++) {
    if (iouScores[index] > iouScores[best]) best = index
  }
  return best
}

/**
 * How many pixels each candidate mask covers.
 *
 * Counted in pixels rather than as a fraction of the frame because that is what
 * decides whether a mask is a real (if small) thing or noise: an eye is a few
 * hundred pixels whatever the photo's dimensions, while a fraction that reads as
 * "0.0%" of the frame can be either.
 *
 * @param masks - The packed mask buffer from `post_process_masks`.
 * @param count - How many candidates the buffer holds.
 * @param size - Pixels per candidate (`width * height`).
 * @returns One pixel count per candidate.
 */
export function maskPixelCounts(
  masks: Uint8Array | Uint8ClampedArray,
  count: number,
  size: number,
): number[] {
  const counts: number[] = []
  for (let index = 0; index < count; index++) {
    const start = index * size
    let on = 0
    for (let i = 0; i < size; i++) {
      if (masks[start + i]) on++
    }
    counts.push(on)
  }
  return counts
}

/**
 * Scores within this much of the best are treated as equally confident.
 *
 * Measured, not guessed: a click on an eye scored the face 0.874 and the eye
 * 0.785 — both plainly valid readings of the same click, 0.089 apart. A wrong
 * mask falls much further than that, so the margin sits just above the gap.
 */
const SCORE_MARGIN = 0.1

/**
 * Candidates smaller than this are noise, not detail. The masks come back at
 * inference resolution (~1024px on the long edge), where a real feature — an
 * eye, a button — is hundreds of pixels; this only rejects the degenerate
 * near-empty candidate SAM sometimes returns as its third answer.
 */
const MIN_MASK_PIXELS = 64

/**
 * Picks a candidate by size rather than by confidence.
 *
 * The candidates form a ladder — measured on two real clicks: 15%, 2.6% and
 * 0.036% of the frame for the same point — so ranking them by pixel count and
 * naming the rungs is what turns SAM's ambiguity into a control the user can
 * work. Ranking (rather than trusting the model's output order) costs nothing
 * and cannot be wrong-footed if that order ever changes.
 *
 * Near-empty candidates are excluded first: they are failures, not detail. If
 * every candidate is one, the caller's confidence pick stands.
 *
 * @param pixels - Pixel count per candidate.
 * @param granularity - Which rung: largest, middle or smallest.
 * @param fallback - Index to use when no candidate is usable.
 * @returns The index of the mask to use.
 */
function maskIndexByGranularity(
  pixels: ArrayLike<number>,
  granularity: Exclude<MaskGranularity, 'auto'>,
  fallback: number,
): number {
  const ranked: number[] = []
  for (let index = 0; index < pixels.length; index++) {
    if (pixels[index] >= MIN_MASK_PIXELS) ranked.push(index)
  }
  if (ranked.length === 0) return fallback
  ranked.sort((a, b) => pixels[b] - pixels[a])

  if (granularity === 'whole') return ranked[0]
  if (granularity === 'detail') return ranked[ranked.length - 1]
  // 'part': the middle rung, clamped when the model returned fewer candidates.
  return ranked[Math.min(1, ranked.length - 1)]
}

/**
 * Picks which of SAM's candidate masks to keep.
 *
 * One click is genuinely ambiguous — clicking an eye could mean the eye, the
 * face or the person, and SAM answers with all three. Taking the top score there
 * reliably returns the *largest* reading, which is the one the user did not need
 * to point precisely for. So among candidates the model is equally sure about
 * (within {@link SCORE_MARGIN}), the smallest is kept: pointing at a detail
 * selects the detail, and a click on something unambiguous still has only one
 * confident answer to give.
 *
 * That guess is only ever a guess — the scores do not encode what the user
 * meant — so an explicit `granularity` overrides it outright.
 *
 * A prompt that is already specific — several points, or a box — is left alone:
 * there the user has said what they want, and shrinking would fight them.
 *
 * @param iouScores - One confidence per candidate.
 * @param pixels - Pixel count per candidate, from {@link maskPixelCounts}.
 * @param ambiguous - Whether the prompt was a single point with no box.
 * @param granularity - Which rung of the size ladder the user asked for.
 * Anything but `'auto'` overrides the guessing entirely.
 * @returns The index of the mask to use.
 */
export function chooseMaskIndex(
  iouScores: ArrayLike<number>,
  pixels: ArrayLike<number>,
  ambiguous: boolean,
  granularity: MaskGranularity = 'auto',
): number {
  const best = bestMaskIndex(iouScores)
  if (granularity !== 'auto') return maskIndexByGranularity(pixels, granularity, best)
  if (!ambiguous) return best

  // Starts at "nothing chosen" rather than at `best`, because `best` itself can
  // be the near-empty candidate the pixel floor exists to reject.
  let chosen = -1
  for (let index = 0; index < iouScores.length; index++) {
    if (iouScores[index] < iouScores[best] - SCORE_MARGIN) continue
    // A near-empty mask is a failed candidate, not a fine-grained one.
    if (pixels[index] < MIN_MASK_PIXELS) continue
    if (chosen === -1 || pixels[index] < pixels[chosen]) chosen = index
  }
  return chosen === -1 ? best : chosen
}

/**
 * Turns one boolean SAM mask into the 0/255 weight map the pipeline speaks.
 *
 * `post_process_masks` packs every candidate mask back-to-back into a single
 * buffer — `[mask0 | mask1 | …]`, each `width*height` booleans (0 or 1) — so
 * `index` selects one. A set pixel becomes 255 (fully selected), a clear one 0.
 *
 * @param masks - The packed mask buffer from `post_process_masks`.
 * @param index - Which candidate to extract (see {@link bestMaskIndex}).
 * @param width - Mask width in pixels.
 * @param height - Mask height in pixels.
 * @returns The weight map at the mask's own resolution.
 * @throws If the buffer is too short to hold `index`'s slice.
 */
export function maskToAlpha(
  masks: Uint8Array | Uint8ClampedArray,
  index: number,
  width: number,
  height: number,
): MaskAlpha {
  const size = width * height
  const start = index * size
  if (masks.length < start + size) {
    throw new Error(`Mask buffer too short: got ${masks.length}, need ${start + size}`)
  }
  const data = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    data[i] = masks[start + i] ? 255 : 0
  }
  return { data, width, height }
}
