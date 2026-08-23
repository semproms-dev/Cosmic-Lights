/**
 * Returns a fresh UUID for library records, stacks and masks.
 *
 * Prefers the platform's `crypto.randomUUID`, which is the fastest and best
 * source of randomness — but that API only exists in **secure contexts**
 * (HTTPS or `localhost`). A device served over plain HTTP (a Raspberry Pi on
 * the LAN, say) hides it entirely, and calling it there throws. The fallback
 * builds an RFC 4122 version 4 UUID from `crypto.getRandomValues`, which the
 * platform provides in insecure contexts too.
 *
 * @returns A random v4 UUID in canonical 8-4-4-4-12 hex form.
 */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex: string[] = []
  for (const byte of bytes) hex.push(byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
