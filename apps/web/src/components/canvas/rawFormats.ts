import { logger } from '../../logger'

/** RAW file extensions the app decodes with LibRaw. */
export const RAW_EXTENSIONS = [
  '.arw',
  '.cr2',
  '.cr3',
  '.nef',
  '.dng',
  '.raf',
  '.orf',
  '.rw2',
] as const

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const

/**
 * Whether the file's *bytes* say JPEG, whatever its name claims.
 *
 * Reads three bytes, so it costs nothing next to a decode. This is the one
 * question `file.type` cannot answer: the browser derives the MIME type from the
 * extension, so a renamed file lies there too.
 *
 * @param file - The file the user opened or dropped.
 * @returns True when the file starts with the JPEG SOI marker; false if it does
 *   not, and false on a read error — an unreadable file fails at decode anyway,
 *   with a better message than this function could give.
 */
export async function isFileJpg(file: File): Promise<boolean> {
  try {
    const header = new Uint8Array(await file.slice(0, JPEG_SIGNATURE.length).arrayBuffer());
    return JPEG_SIGNATURE.every((byte, index) => header[index] == byte);
  } catch(error) {
    logger.error(`could not read the header of ${file.name}`, error)
    return false;
  }
}

/**
 * Already-developed formats the browser itself decodes. They skip LibRaw
 * entirely, so they carry no camera metadata into the editor — see `loadImage`.
 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg'] as const

/** Everything the app can open, RAW or not. */
export const SUPPORTED_EXTENSIONS = [...RAW_EXTENSIONS, ...IMAGE_EXTENSIONS] as const

/** Comma-separated `accept` string for a native `<input type="file">`. */
export const SUPPORTED_ACCEPT = SUPPORTED_EXTENSIONS.join(',')

/** Whether `name` ends with one of `extensions` (case-insensitive). */
function hasExtension(name: string, extensions: readonly string[]): boolean {
  const lower = name.toLowerCase()
  return extensions.some((extension) => lower.endsWith(extension))
}

/**
 * Whether a file needs the LibRaw decoder. This is what picks the branch in
 * `loadImage`, so it must stay a *name* test: RAW files report unreliable (or
 * empty) MIME types, which is exactly why the extension is the dependable signal.
 */
export function isRawFile(file: File): boolean {
  return hasExtension(file.name, RAW_EXTENSIONS)
}

/**
 * Whether the app can open this file at all.
 *
 * JPEGs are additionally accepted by MIME type: unlike RAW, `image/jpeg` is
 * reported reliably, and it rescues a file whose name lost its extension (a
 * download, a paste, an export from another tool).
 */
export function isSupportedFile(file: File): boolean {
  return hasExtension(file.name, SUPPORTED_EXTENSIONS) || file.type === 'image/jpeg'
}
