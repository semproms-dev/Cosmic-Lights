/** RAW file extensions the app can decode. */
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

/** Comma-separated `accept` string for a native `<input type="file">`. */
export const RAW_ACCEPT = RAW_EXTENSIONS.join(',')

/**
 * Whether a file looks like a supported RAW photo, checked by extension. RAW
 * files report unreliable MIME types, so the name is the dependable signal.
 */
export function isRawFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return RAW_EXTENSIONS.some((ext) => name.endsWith(ext))
}
