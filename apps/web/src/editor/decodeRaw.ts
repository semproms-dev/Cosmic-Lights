import LibRaw, { type Metadata } from 'libraw-wasm'
import { logger } from '../logger'

/** Result of decoding a RAW file: 8-bit RGB pixels plus the parsed metadata. */
export interface DecodedRaw {
  /** Interleaved 8-bit RGB pixels (3 bytes per pixel). */
  data: Uint8Array
  width: number
  height: number
  metadata: Metadata
}

/**
 * Baseline exposure, as the linear multiplier LibRaw's `exp_shift` expects.
 *
 * With auto-brightening off, LibRaw maps the sensor's saturation point to white
 * and adds no gain of its own. That is honest but dark: a sensor keeps several
 * stops of headroom above middle grey for speculars, so mapping saturation to
 * white leaves the whole frame sitting low. Every mature developer closes that
 * gap with a fixed baseline — Adobe's `BaselineExposure`, darktable's exposure
 * module — and this constant is ours.
 *
 * It is stored as the multiplier rather than as stops on purpose, because the
 * two do not convert the way one would expect. Measured on the same file: a
 * multiplier of 3.73 — nominally +1.9 stops against a 2.2 gamma — moved the
 * output by a ratio of 2.14 in code value, i.e. ~2.4 stops. Fitting a power law
 * through that point and the identity puts LibRaw's effective exponent near 1.73,
 * not 2.2. Any "stops" figure here would therefore be a lie about what the
 * decoder does, so the honest thing to keep is the number actually sent.
 *
 * Calibrated against darktable's default rendering of the same Canon R5 frame,
 * which put the water at ~112 and the white plumage at 142 where an unshifted
 * decode gave 62 and 73. This value splits those two targets.
 *
 * Provisional. It comes from a single frame of a single body — and an awkward
 * frame at that, a small bright bird on dark water with no real mid grey. It
 * wants checking across more scenes and more cameras before it is treated as
 * settled, and reading the DNG `baseline_exposure` tag would refine it further.
 */
const BASELINE_EXP_SHIFT = 2.85

/**
 * Decodes a RAW file to 8-bit RGB using LibRaw (compiled to WASM, runs in the
 * library's own Web Worker). Half-size and camera white balance are applied so
 * the first render is fast and looks natural, and a fixed baseline exposure
 * brings the result up to where other developers place the same file.
 *
 * The baseline is applied *here* rather than in the shader on purpose. LibRaw
 * scales the sensor's 14 bits and quantises to 8 afterwards, so the gain costs
 * nothing; the same lift applied downstream would stretch already-quantised data
 * by ~1.8x, spreading some 140 distinct levels over 255 and banding every smooth
 * gradient in the frame.
 *
 * @param buffer - The raw file bytes.
 * @returns The decoded RGB pixels, dimensions and metadata.
 * @throws if the file cannot be decoded or comes back in an unexpected format.
 */
export const decodeRaw = async (buffer: ArrayBuffer): Promise<DecodedRaw> => {
  const raw = new LibRaw()
  try {
    await raw.open(new Uint8Array(buffer), {
      halfSize: true,
      useCameraWb: true,
      noAutoBright: true,
      // The master switch: without it LibRaw ignores both exposure fields below
      // without a word of complaint.
      expCorrec: true,
      expShift: BASELINE_EXP_SHIFT,
      // Roll the highlights off instead of letting them flatten against white:
      // the shift happens in linear light before the output curve, so anything
      // it pushes past saturation would otherwise clip.
      expPreser: 1,
      // `highlight` is deliberately absent. Any non-zero value makes LibRaw
      // normalise the white balance multipliers by the largest rather than the
      // smallest, reserving headroom for reconstruction — measured at 1.5 stops
      // of global darkening on an R5, paid by every photo to benefit only the
      // few that actually clip. If highlight recovery is ever offered, it
      // belongs behind a user control that compensates for that loss.
    })
    const metadata = await raw.metadata(true)
    const image = await raw.imageData()

    if (!metadata || !image) {
      throw new Error('libraw returned no data')
    }
    if (image.bits !== 8 || image.colors !== 3) {
      throw new Error(
        `unexpected decode format: ${image.colors} channels @ ${image.bits} bits (want 3×8)`,
      )
    }

    return {
      // Narrowed to Uint8Array by the bits === 8 check above (data is Uint8Array | Uint16Array).
      data: image.data as Uint8Array,
      width: image.width,
      height: image.height,
      metadata,
    }
  } catch (error) {
    logger.error('decodeRaw failed', error)
    throw error
  } finally {
    // Free the WASM instance so repeated opens don't leak the heap.
    raw.dispose()
  }
}
