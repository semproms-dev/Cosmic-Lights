import {
  basicAdjustments,
  colorAdjustement,
  colorMixerAdjustment,
  detailsAdjustement,
  effectsAdjustement,
  gradingAdjustement,
  GRADING_LUM_RANGE,
  MIXER_RANGE,
} from './adjustments'
import { buildDefaultCurves, CHANNELS, type ChannelId, type CurvePoint, type Curves } from './curves'
import type { LoadedImage } from './image'

/** Version of the serialized clipboard payload. Bump on breaking shape changes. */
export const DEVELOP_CLIPBOARD_VERSION = 1

/** Marker that identifies a CosmicLights develop file. */
export const DEVELOP_FILE_KIND = 'cosmichlights.develop'

/** The dimensions and name of the photo a develop was copied from. */
export type DevelopSource = Pick<LoadedImage, 'fileName' | 'width' | 'height'>

/**
 * A self-contained snapshot of the global develop: every slider, the tone
 * curves and the source photo's basic identity.
 *
 * It deliberately does not reuse {@link import('./presets').Preset}: a preset is
 * a *partial* recipe, while pasting must reproduce the copied develop exactly.
 */
export interface CopiedDevelop {
  schemaVersion: number
  source: DevelopSource | null
  adjustments: Record<string, number>
  curves: Curves
}

/**
 * The on-disk form of a copied develop. It adds provenance to the clipboard
 * payload so an imported file can be identified and debugged.
 */
export interface DevelopFile extends CopiedDevelop {
  kind: typeof DEVELOP_FILE_KIND
  createdAt: string
  generator: {
    app: string
    version: string
  }
}

interface NumericRange {
  min: number
  max: number
}

/** Builds the accepted range for every slider and flat adjustment key. */
function buildRanges(): Map<string, NumericRange> {
  const ranges = new Map<string, NumericRange>()
  const addOptions = (options: readonly { key: string; min: number; max: number }[]): void => {
    for (const option of options) {
      ranges.set(option.key, { min: option.min, max: option.max })
    }
  }

  addOptions(basicAdjustments)
  addOptions(colorAdjustement)
  addOptions(detailsAdjustement)
  addOptions(effectsAdjustement)

  for (const option of gradingAdjustement) {
    ranges.set(option.hueKey, { min: 0, max: 360 })
    ranges.set(option.satKey, { min: 0, max: 100 })
    ranges.set(option.lumKey, { min: -GRADING_LUM_RANGE, max: GRADING_LUM_RANGE })
  }

  for (const option of colorMixerAdjustment) {
    for (const key of [option.hueKey, option.satKey, option.lumKey]) {
      ranges.set(key, { min: -MIXER_RANGE, max: MIXER_RANGE })
    }
  }

  // Classic templates: 0 = none, 1 = black and white, 2 = sepia.
  ranges.set('template', { min: 0, max: 2 })

  return ranges
}

const RANGES = buildRanges()

/** Deep-copies a curve set so caller and clipboard can never share points. */
function cloneCurves(curves: Curves): Curves {
  return Object.fromEntries(
    CHANNELS.map((channel) => [channel, curves[channel].map((point) => ({ ...point }))]),
  ) as Curves
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Narrows an unknown JSON value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads the known adjustment keys, dropping unknown or malformed entries. */
function readFileAdjustments(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null

  const adjustments: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value)) {
    const range = RANGES.get(key)
    if (range === undefined) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    adjustments[key] = clamp(raw, range.min, range.max)
  }

  return adjustments
}

/** Reads the source identity, falling back to `null` when it is malformed. */
function readFileSource(value: unknown): DevelopSource | null {
  if (!isRecord(value)) return null

  const { fileName, width, height } = value
  if (typeof fileName !== 'string') return null
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return null
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null

  return { fileName, width, height }
}

/** Reads the generator block, or `null` when it is missing or malformed. */
function readFileGenerator(value: unknown): DevelopFile['generator'] | null {
  if (!isRecord(value)) return null

  const { app, version } = value
  if (typeof app !== 'string' || typeof version !== 'string') return null

  return { app, version }
}

/**
 * Serializes a develop snapshot into the JSON document written to disk.
 *
 * @param develop - The snapshot to export.
 * @param appVersion - The running app version, stored for provenance.
 * @param createdAt - Timestamp to embed; defaults to now.
 */
export function serializeDevelopFile(
  develop: CopiedDevelop,
  appVersion: string,
  createdAt: Date = new Date(),
): string {
  const file: DevelopFile = {
    kind: DEVELOP_FILE_KIND,
    schemaVersion: DEVELOP_CLIPBOARD_VERSION,
    createdAt: createdAt.toISOString(),
    generator: { app: 'CosmicLights', version: appVersion },
    source: develop.source === null ? null : { ...develop.source },
    adjustments: { ...develop.adjustments },
    curves: cloneCurves(develop.curves),
  }

  return JSON.stringify(file, null, 2)
}

/**
 * Parses an untrusted develop file.
 *
 * Returns `null` instead of throwing when the JSON is malformed, the marker or
 * version does not match, or the payload shape is wrong. Adjustment values are
 * clamped to their slider ranges and curves fall back to the identity line, so
 * an imported file can never feed invalid data into the renderer.
 *
 * @param text - The raw file contents.
 */
export function parseDevelopFile(text: string): DevelopFile | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }

  if (!isRecord(value)) return null
  if (value.kind !== DEVELOP_FILE_KIND) return null
  if (value.schemaVersion !== DEVELOP_CLIPBOARD_VERSION) return null
  if (typeof value.createdAt !== 'string') return null

  const generator = readFileGenerator(value.generator)
  const adjustments = readFileAdjustments(value.adjustments)
  if (generator === null || adjustments === null) return null
  if (!isRecord(value.curves)) return null

  return {
    kind: DEVELOP_FILE_KIND,
    schemaVersion: DEVELOP_CLIPBOARD_VERSION,
    createdAt: value.createdAt,
    generator,
    source: readFileSource(value.source),
    adjustments,
    curves: sanitizeDevelopCurves(value.curves as Curves),
  }
}

/**
 * Snapshot of the current global develop, safe to keep after the photo changes.
 *
 * @param adjustments - The live slider map.
 * @param curves - The live tone curves.
 * @param source - The open photo, or `null` if there is none.
 */
export function createCopiedDevelop(
  adjustments: Record<string, number>,
  curves: Curves,
  source: DevelopSource | null,
): CopiedDevelop {
  return {
    schemaVersion: DEVELOP_CLIPBOARD_VERSION,
    source: source === null ? null : { ...source },
    adjustments: { ...adjustments },
    curves: cloneCurves(curves),
  }
}

/**
 * Builds the adjustment map to paste: the given defaults with the copied values
 * on top.
 *
 * Only keys the defaults already know survive (dropping stale or unknown keys),
 * non-finite values are ignored and every known key is clamped to its slider
 * range. A copied map can therefore never feed `NaN` or an absurd value into the
 * shader.
 *
 * @param values - The adjustments read from the clipboard.
 * @param base - The defaults to start from, normally `buildInitialAdjustments()`.
 */
export function sanitizeDevelopAdjustments(
  values: Record<string, number>,
  base: Record<string, number>,
): Record<string, number> {
  const result = { ...base }

  for (const key of Object.keys(base)) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue
    const value = values[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue

    const range = RANGES.get(key)
    result[key] = range === undefined ? value : clamp(value, range.min, range.max)
  }

  return result
}

/** Upper bound for one channel's curve, far above what the editor produces. */
const MAX_CURVE_POINTS = 256

/** Returns a valid point list, or `null` when the input cannot be trusted. */
function sanitizePoints(points: CurvePoint[]): CurvePoint[] | null {
  if (!Array.isArray(points) || points.length < 2) return null
  if (points.length > MAX_CURVE_POINTS) return null

  const clean: CurvePoint[] = []
  for (const point of points) {
    if (typeof point !== 'object' || point === null) return null
    const { x, y } = point as { x?: unknown; y?: unknown }
    if (typeof x !== 'number' || !Number.isFinite(x)) return null
    if (typeof y !== 'number' || !Number.isFinite(y)) return null
    clean.push({ x: clamp(x, 0, 255), y: clamp(y, 0, 255) })
  }

  return clean
}

/**
 * Validates and deep-copies a copied curve set. Channels with malformed data
 * fall back to the identity line instead of corrupting the render.
 *
 * @param curves - The curves read from the clipboard.
 */
export function sanitizeDevelopCurves(curves: Curves): Curves {
  const result = buildDefaultCurves()

  for (const channel of CHANNELS) {
    const points = sanitizePoints(curves[channel])
    if (points !== null) result[channel as ChannelId] = points
  }

  return result
}
