import { describe, expect, it } from 'vitest'
import { buildDefaultCurves } from './curves'
import {
  createCopiedDevelop,
  DEVELOP_CLIPBOARD_VERSION,
  DEVELOP_FILE_KIND,
  parseDevelopFile,
  sanitizeDevelopAdjustments,
  sanitizeDevelopCurves,
  serializeDevelopFile,
} from './developClipboard'
import { buildInitialAdjustments } from './editorReducer'

const SOURCE = { fileName: 'photo.arw', width: 6000, height: 4000 }

describe('createCopiedDevelop', () => {
  it('snapshots the develop and copies it away from the live state', () => {
    const adjustments = { ...buildInitialAdjustments(), exposure: 0.4 }
    const curves = buildDefaultCurves()
    curves.rgb = [
      { x: 0, y: 0 },
      { x: 128, y: 170 },
      { x: 255, y: 255 },
    ]

    const copied = createCopiedDevelop(adjustments, curves, SOURCE)

    adjustments.exposure = -1
    curves.rgb[1].y = 0

    expect(copied.schemaVersion).toBe(DEVELOP_CLIPBOARD_VERSION)
    expect(copied.adjustments.exposure).toBe(0.4)
    expect(copied.curves.rgb[1].y).toBe(170)
    expect(copied.source).toEqual(SOURCE)
  })

  it('accepts a missing photo', () => {
    const copied = createCopiedDevelop(buildInitialAdjustments(), buildDefaultCurves(), null)

    expect(copied.source).toBeNull()
  })
})

describe('sanitizeDevelopAdjustments', () => {
  it('clamps known values to their slider range and drops unknown keys', () => {
    const next = sanitizeDevelopAdjustments(
      {
        exposure: 5,
        contrast: -999,
        grainSize: -10,
        template: 9,
        unknownKey: 3,
      },
      buildInitialAdjustments(),
    )

    expect(next.exposure).toBe(1)
    expect(next.contrast).toBe(-100)
    expect(next.grainSize).toBe(0)
    expect(next.template).toBe(2)
    expect(next).not.toHaveProperty('unknownKey')
  })

  it('keeps the default for missing or non-finite values', () => {
    const next = sanitizeDevelopAdjustments(
      { exposure: Number.NaN, contrast: Number.POSITIVE_INFINITY },
      buildInitialAdjustments(),
    )

    expect(next.exposure).toBe(0)
    expect(next.contrast).toBe(0)
  })

  it('still returns every default key for an empty clipboard', () => {
    expect(sanitizeDevelopAdjustments({}, buildInitialAdjustments())).toEqual(
      buildInitialAdjustments(),
    )
  })
})

describe('sanitizeDevelopCurves', () => {
  it('deep-copies valid channels', () => {
    const curves = buildDefaultCurves()
    curves.red = [
      { x: 0, y: 10 },
      { x: 255, y: 240 },
    ]

    const next = sanitizeDevelopCurves(curves)
    next.red[0].y = 99

    expect(curves.red[0].y).toBe(10)
  })

  it('clamps points into the 0..255 domain', () => {
    const curves = buildDefaultCurves()
    curves.rgb = [
      { x: -10, y: -20 },
      { x: 300, y: 400 },
    ]

    const next = sanitizeDevelopCurves(curves)

    expect(next.rgb).toEqual([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ])
  })

  it('falls back to the identity line for malformed channels', () => {
    const curves = buildDefaultCurves()
    curves.blue = [{ x: 0, y: 0 }]
    curves.green = [
      { x: 0, y: 0 },
      { x: Number.NaN, y: 255 },
    ]

    const next = sanitizeDevelopCurves(curves)

    expect(next.blue).toEqual(buildDefaultCurves().blue)
    expect(next.green).toEqual(buildDefaultCurves().green)
  })

  it('rejects a channel with more points than the editor can produce', () => {
    const curves = buildDefaultCurves()
    curves.red = Array.from({ length: 257 }, (_, index) => ({ x: index, y: index }))

    const next = sanitizeDevelopCurves(curves)

    expect(next.red).toEqual(buildDefaultCurves().red)
  })
})

describe('serializeDevelopFile', () => {
  it('writes a versioned, self-describing document', () => {
    const develop = createCopiedDevelop(buildInitialAdjustments(), buildDefaultCurves(), SOURCE)
    const text = serializeDevelopFile(develop, '9.9.9', new Date('2026-01-02T03:04:05.000Z'))
    const raw = JSON.parse(text) as Record<string, unknown>

    expect(raw.kind).toBe(DEVELOP_FILE_KIND)
    expect(raw.schemaVersion).toBe(DEVELOP_CLIPBOARD_VERSION)
    expect(raw.createdAt).toBe('2026-01-02T03:04:05.000Z')
    expect(raw.generator).toEqual({ app: 'CosmicLights', version: '9.9.9' })
    expect(raw.source).toEqual(SOURCE)
  })

  it('round-trips the develop through parseDevelopFile', () => {
    const adjustments = { ...buildInitialAdjustments(), exposure: 0.4 }
    const curves = buildDefaultCurves()
    curves.rgb = [
      { x: 0, y: 0 },
      { x: 128, y: 170 },
      { x: 255, y: 255 },
    ]
    const develop = createCopiedDevelop(adjustments, curves, SOURCE)

    const parsed = parseDevelopFile(serializeDevelopFile(develop, '1.0.0'))

    expect(parsed).not.toBeNull()
    expect(parsed?.adjustments).toEqual(adjustments)
    expect(parsed?.curves).toEqual(curves)
    expect(parsed?.source).toEqual(SOURCE)
  })
})

describe('parseDevelopFile', () => {
  const develop = createCopiedDevelop(
    { ...buildInitialAdjustments(), exposure: 0.4 },
    buildDefaultCurves(),
    SOURCE,
  )
  const valid = (): Record<string, unknown> =>
    JSON.parse(serializeDevelopFile(develop, '1.0.0')) as Record<string, unknown>

  it('rejects malformed JSON and non-object payloads', () => {
    expect(parseDevelopFile('{')).toBeNull()
    expect(parseDevelopFile('null')).toBeNull()
    expect(parseDevelopFile('[]')).toBeNull()
  })

  it('rejects a wrong marker or unsupported version', () => {
    expect(parseDevelopFile(JSON.stringify({ ...valid(), kind: 'other' }))).toBeNull()
    expect(parseDevelopFile(JSON.stringify({ ...valid(), schemaVersion: 99 }))).toBeNull()
  })

  it('rejects missing provenance and non-object payload sections', () => {
    expect(parseDevelopFile(JSON.stringify({ ...valid(), generator: undefined }))).toBeNull()
    expect(parseDevelopFile(JSON.stringify({ ...valid(), adjustments: [] }))).toBeNull()
    expect(parseDevelopFile(JSON.stringify({ ...valid(), curves: null }))).toBeNull()
  })

  it('drops unknown or malformed adjustments and clamps known ones', () => {
    const parsed = parseDevelopFile(JSON.stringify({
      ...valid(),
      adjustments: { exposure: 5, contrast: 'bad', unknownKey: 3 },
    }))

    expect(parsed?.adjustments.exposure).toBe(1)
    expect(parsed?.adjustments).not.toHaveProperty('contrast')
    expect(parsed?.adjustments).not.toHaveProperty('unknownKey')
  })

  it('falls back to the identity curve when a channel is malformed', () => {
    const parsed = parseDevelopFile(JSON.stringify({
      ...valid(),
      curves: { rgb: [{ x: 0, y: 0 }] },
    }))

    expect(parsed?.curves.rgb).toEqual(buildDefaultCurves().rgb)
  })

  it('ignores a malformed source instead of rejecting the file', () => {
    const parsed = parseDevelopFile(JSON.stringify({
      ...valid(),
      source: { fileName: 'x.jpg', width: 0, height: 100 },
    }))

    expect(parsed).not.toBeNull()
    expect(parsed?.source).toBeNull()
  })
})
