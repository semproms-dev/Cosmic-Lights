import type { Photo, PhotoId } from './library'

/**
 * Largest silence (in milliseconds) between two shots that still counts as the
 * same burst. 1.5 s sits comfortably above a camera's continuous-drive rate and
 * below the pause between deliberate separate shots — Lightroom's own
 * auto-stack defaults to 1 minute for scan sessions but bursts want seconds.
 */
export const DEFAULT_AUTO_STACK_GAP_MS = 1500

/**
 * Groups photos into burst/bracket candidates by capture time.
 *
 * Photos whose capture times (sorted ascending) are never more than
 * `maxGapMs` apart land in the same group; a larger gap starts a new one.
 * Photos without EXIF time cannot be placed on any timeline and are skipped —
 * manual stacking is their route. Groups of one are dropped: they have nothing
 * to stack with.
 *
 * Pure: the input order is irrelevant and never mutated.
 *
 * @param photos - The photos to cluster.
 * @param maxGapMs - The largest gap inside one group. Defaults to
 *   {@link DEFAULT_AUTO_STACK_GAP_MS}.
 * @returns The groups, each in capture order, earliest first.
 */
export function autoStackGroups(
  photos: Photo[],
  maxGapMs: number = DEFAULT_AUTO_STACK_GAP_MS,
): PhotoId[][] {
  const timed: Array<{ id: PhotoId; time: number }> = []
  for (const photo of photos) {
    if (photo.captureTime !== null) timed.push({ id: photo.id, time: photo.captureTime })
  }
  timed.sort((a, b) => a.time - b.time)

  const groups: PhotoId[][] = []
  let current: PhotoId[] = []
  let previousTime: number | null = null
  for (const entry of timed) {
    // Strictly greater: a gap of exactly `maxGapMs` still belongs together.
    if (previousTime !== null && entry.time - previousTime > maxGapMs) {
      if (current.length >= 2) groups.push(current)
      current = []
    }
    current.push(entry.id)
    previousTime = entry.time
  }
  if (current.length >= 2) groups.push(current)
  return groups
}
