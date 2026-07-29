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
