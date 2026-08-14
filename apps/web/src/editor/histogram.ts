/**
 * Luma histogram of the decoded pixels, measured once at load time.
 *
 * The Auto adjust button needs to know how a photo's tones are spread before
 * deciding how to move them: a bright frame wants a negative exposure, a flat
 * one wants contrast, crushed blacks want the black point lifted. Like the
 * noise estimate (`estimateNoise`), the histogram is computed here — on the
 * same RGBA the decoders already hold in memory — and stored on the image, so
 * the button later costs nothing and always reasons about the *original*
 * pixels, never about the current edits.
 *
 * It is deliberately cheap and pure: a single stride-limited pass over the
 * pixels, unit-testable without a GPU, a canvas or a shader.
 *
 * ## Why percentiles, and why these ones
 *
 * The raw bins are the frame's truth, but Auto reasons about five points of
 * the cumulative distribution, each chosen for what it tells the mapping:
 *
 * - **p50** (median) — where the image as a whole sits; feeds exposure.
 * - **p0.1 / p99.9** — the genuine tails, where clipping actually starts;
 *   feed whites and blacks. The 0.1% (not 1%) is deliberate: a single hot
 *   specular is ordinary content, not an overexposure, and Auto should not
 *   chase it.
 * - **p10 / p90** — the quartertone zones, deep enough to be content yet far
 *   enough out that a photo lives or dies there; feed highlights, shadows and
 *   contrast.
 */

/** Luma weights, matching the shader's `LUMA` and `noiseEstimate`'s. */
const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

/** Histogram bins: one per 8-bit luma level, 0..255. */
export const HISTOGRAM_BINS = 256

/**
 * Upper bound on sampled pixels per call. The stride grows so a 45 MP frame
 * costs no more than a 1 MP one — the percentiles are a statistical estimate,
 * not an exhaustive census.
 */
export const HISTOGRAM_MAX_SAMPLES = 16 * 1024 * 1024

/**
 * Longest edge the browser-decoded path materialises for measurement.
 *
 * A JPEG arrives as an `ImageBitmap` with no pixel buffer in hand (unlike the
 * RAW path), so the histogram reads it through a canvas — and must never
 * materialise the full frame: a 45 MP bitmap needs 180 MB in an RGBA buffer.
 * The histogram is robust to the browser's averaging filter, so it downsizes
 * to at most this edge first. That averaging does cost the extreme tails (a
 * one-pixel specular greys away), which Auto accepts rather than pay for a
 * full-resolution read.
 */
export const HISTOGRAM_MAX_EDGE = 1024

/** One measured frame's luma distribution. */
export interface LumaHistogram {
  /** One entry per 8-bit luma level: how many sampled pixels fell in it. */
  bins: number[]
  /** Number of sampled pixels that produced the bins. */
  total: number
  /** 0.1% percentile, i.e. the near-clipped blacks, in 0..1 luma. */
  p0_1: number
  /** 10th percentile, the darks, in 0..1 luma. */
  p10: number
  /** Median, in 0..1 luma. */
  p50: number
  /** 90th percentile, the brights, in 0..1 luma. */
  p90: number
  /** 99.9% percentile, the near-clipped whites, in 0..1 luma. */
  p99_9: number
}

/**
 * The grid stride that keeps a frame within {@link HISTOGRAM_MAX_SAMPLES}.
 *
 * One in `stride` pixels is sampled along each axis, so the sample count is
 * divided by `stride²`. Exported so the capping rule is testable on its own.
 *
 * @param width - Frame width in pixels.
 * @param height - Frame height in pixels.
 * @returns A stride of at least 1.
 */
export function histogramStride(width: number, height: number): number {
  return Math.max(1, Math.ceil(Math.sqrt((width * height) / HISTOGRAM_MAX_SAMPLES)))
}

/**
 * The luma value at a given fraction of the cumulative distribution, with
 * linear interpolation inside the bin the fraction lands in.
 *
 * @param bins - One count per 8-bit luma level.
 * @param total - Sum of `bins`, i.e. the sample count.
 * @param fraction - Position in the distribution, in [0, 1].
 * @returns A luma in 0..1.
 */
function lumaPercentile(bins: number[], total: number, fraction: number): number {
  if (total <= 0) {
    return 0
  }
  const target = (total - 1) * fraction
  let cumulative = 0
  for (let bin = 0; bin < bins.length; bin++) {
    cumulative += bins[bin]
    if (cumulative > target) {
      const before = cumulative - bins[bin]
      const within = bins[bin] > 0 ? (target - before) / bins[bin] : 0
      return Math.min(1, (bin + within) / (HISTOGRAM_BINS - 1))
    }
  }
  return 1
}

/**
 * Measures the luma histogram of a decoded frame.
 *
 * Samples a grid of pixels (one in {@link histogramStride}'s stride along each
 * axis) and accumulates their Rec.709 luma into 256 bins, then reads the five
 * percentiles Auto adjust reasons about. Returns `null` when there is nothing
 * to measure: an empty frame, or a buffer that does not match the dimensions.
 *
 * @param rgba - Interleaved RGBA bytes, length `width * height * 4`.
 * @param width - Frame width in pixels.
 * @param height - Frame height in pixels.
 * @returns The frame's luma histogram, or `null` on invalid input.
 */
export function computeHistogram(rgba: Uint8ClampedArray, width: number, height: number): LumaHistogram | null {
  if (width < 1 || height < 1 || rgba.length < width * height * 4) {
    return null
  }
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0)
  let total = 0
  const stride = histogramStride(width, height)
  const rowBytes = width * 4
  for (let y = 0; y < height; y += stride) {
    const row = y * rowBytes
    for (let x = 0; x < width; x += stride) {
      const i = row + x * 4
      const luma = LUMA_R * rgba[i] + LUMA_G * rgba[i + 1] + LUMA_B * rgba[i + 2]
      bins[Math.min(HISTOGRAM_BINS - 1, luma | 0)] += 1
      total += 1
    }
  }
  return {
    bins,
    total,
    p0_1: lumaPercentile(bins, total, 0.001),
    p10: lumaPercentile(bins, total, 0.1),
    p50: lumaPercentile(bins, total, 0.5),
    p90: lumaPercentile(bins, total, 0.9),
    p99_9: lumaPercentile(bins, total, 0.999),
  }
}
