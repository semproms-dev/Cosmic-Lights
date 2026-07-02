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
 * Decodes a RAW file to 8-bit RGB using LibRaw (compiled to WASM, runs in the
 * library's own Web Worker). Half-size and camera white balance are applied so
 * the first render is fast and looks natural.
 *
 * @param buffer - The raw file bytes.
 * @returns The decoded RGB pixels, dimensions and metadata.
 * @throws if the file cannot be decoded or comes back in an unexpected format.
 */
export const decodeRaw = async (buffer: ArrayBuffer): Promise<DecodedRaw> => {
  const raw = new LibRaw()
  try {
    await raw.open(new Uint8Array(buffer), { halfSize: true, useCameraWb: true })
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
