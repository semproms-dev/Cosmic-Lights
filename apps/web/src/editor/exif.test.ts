import { describe, expect, it } from 'vitest'
import piexif from 'piexifjs'
import type { Metadata } from 'libraw-wasm'
import { buildExifDict, insertExif } from './exif'

// ─────────────────────────────────────────────────────────────────────────────
// Contract for editor/exif.ts. buildExifDict maps libraw's Metadata onto the
// piexif dict; insertExif embeds it into a JPEG. Everything here is pure string/
// object work — no canvas needed.
//
// Note: `includeMetadata` is gated at the call site (ExportPanel only calls
// buildExifDict when it is true), so these tests always pass it as true and
// exercise the GPS gating via `includeGPS`.
// ─────────────────────────────────────────────────────────────────────────────

/** A GPS block with valid, parsed coordinates; override per test. */
const baseGps = {
  latitude: [51, 28, 40.12] as [number, number, number],
  longitude: [0, 7, 40.2] as [number, number, number],
  altitude: 0,
  latref: 'N' as string | null,
  longref: 'W' as string | null,
  altref: 0,
  gpsstatus: 'A' as string | null,
  gpsparsed: true,
}

/** A Metadata fixture with the fields buildExifDict reads; cast since the real
 *  libraw type has ~50 required fields irrelevant to these tests. */
const makeMetadata = (overrides: Record<string, unknown> = {}): Metadata =>
  ({
    camera_make: 'Canon',
    camera_model: 'EOS R5',
    shutter: 0.004,
    aperture: 2.8,
    focal_len: 50,
    iso_speed: 400,
    flip: 6, // a non-normal orientation, to prove it is ignored
    timestamp: new Date(2024, 6, 10, 14, 30, 0),
    artist: '',
    desc: '',
    gps_data: baseGps,
    ...overrides,
  }) as unknown as Metadata

const withMetadata = { includeMetadata: true, includeGPS: false }

describe('buildExifDict — camera identity (0th)', () => {
  it('writes the camera make', () => {
    const dict = buildExifDict(makeMetadata({ camera_make: 'Nikon' }), withMetadata)

    expect(dict['0th']?.[piexif.ImageIFD.Make]).toBe('Nikon')
  })

  it('falls back to "CosmicLights" when the RAW has no software field', () => {
    const dict = buildExifDict(makeMetadata({ software: undefined }), withMetadata)

    expect(dict['0th']?.[piexif.ImageIFD.Software]).toBe('CosmicLights')
  })

  it('writes the export app name in the software tag even when the source metadata contains another value', () => {
    const dict = buildExifDict(makeMetadata({ software: 'Magic Lantern' }), withMetadata)

    expect(dict['0th']?.[piexif.ImageIFD.Software]).toBe('CosmicLights')
  })
})

describe('buildExifDict — optional identity/lens fields', () => {
  it('writes the camera model', () => {
    const dict = buildExifDict(makeMetadata({ camera_model: 'EOS R6' }), withMetadata)

    expect(dict['0th']?.[piexif.ImageIFD.Model]).toBe('EOS R6')
  })

  it('writes the artist when present, omits it when empty', () => {
    const withArtist = buildExifDict(makeMetadata({ artist: 'Ansel Adams' }), withMetadata)
    const noArtist = buildExifDict(makeMetadata({ artist: '' }), withMetadata)

    expect(withArtist['0th']?.[piexif.ImageIFD.Artist]).toBe('Ansel Adams')
    expect(noArtist['0th']?.[piexif.ImageIFD.Artist]).toBeUndefined()
  })

  it('writes FNumber and FocalLength as rationals', () => {
    const dict = buildExifDict(makeMetadata({ aperture: 2.8, focal_len: 50 }), withMetadata)

    expect(dict['Exif']?.[piexif.ExifIFD.FNumber]).toEqual([28, 10])
    expect(dict['Exif']?.[piexif.ExifIFD.FocalLength]).toEqual([500, 10])
  })

  it('formats DateTimeOriginal as "YYYY:MM:DD HH:MM:SS"', () => {
    // Built from local components, so the assertion is timezone-independent.
    const dict = buildExifDict(
      makeMetadata({ timestamp: new Date(2024, 6, 10, 14, 30, 5) }),
      withMetadata,
    )

    expect(dict['Exif']?.[piexif.ExifIFD.DateTimeOriginal]).toBe('2024:07:10 14:30:05')
  })
})

describe('buildExifDict — orientation', () => {
  it('always writes Orientation = 1, never the source flip', () => {
    const dict = buildExifDict(makeMetadata({ flip: 6 }), withMetadata)

    // The exported pixels are already developed/cropped/oriented; copying the
    // source flip would make viewers double-rotate the image.
    expect(dict['0th']?.[piexif.ImageIFD.Orientation]).toBe(1)
  })
})

describe('buildExifDict — exposure (Exif)', () => {
  it('writes ExposureTime as a rational, not a decimal', () => {
    const dict = buildExifDict(makeMetadata({ shutter: 0.004 }), withMetadata)

    expect(dict['Exif']?.[piexif.ExifIFD.ExposureTime]).toEqual([1, 250])
  })

  it('passes ISO through as an integer', () => {
    const dict = buildExifDict(makeMetadata({ iso_speed: 800 }), withMetadata)

    expect(dict['Exif']?.[piexif.ExifIFD.ISOSpeedRatings]).toBe(800)
  })
})

describe('buildExifDict — GPS gating', () => {
  it('omits GPS when includeGPS is false', () => {
    const dict = buildExifDict(makeMetadata(), { includeMetadata: true, includeGPS: false })

    expect(dict['GPS']).toBeUndefined()
  })

  it('omits GPS when the RAW has no parsed GPS, even if requested', () => {
    const dict = buildExifDict(
      makeMetadata({ gps_data: { ...baseGps, gpsparsed: false } }),
      { includeMetadata: true, includeGPS: true },
    )

    expect(dict['GPS']).toBeUndefined()
  })

  it('omits GPS when the hemisphere refs are missing', () => {
    const dict = buildExifDict(
      makeMetadata({ gps_data: { ...baseGps, latref: null, longref: null } }),
      { includeMetadata: true, includeGPS: true },
    )

    expect(dict['GPS']).toBeUndefined()
  })

  it('writes latitude and longitude when requested and available', () => {
    const dict = buildExifDict(makeMetadata(), { includeMetadata: true, includeGPS: true })
    const gps = dict['GPS']

    // Latitude must mirror longitude: Ref = hemisphere string, coord = 3 rationals.
    expect(gps?.[piexif.GPSIFD.GPSLatitudeRef]).toBe('N')
    expect(gps?.[piexif.GPSIFD.GPSLatitude]).toEqual([[51, 1], [28, 1], [4012, 100]])
    expect(gps?.[piexif.GPSIFD.GPSLongitudeRef]).toBe('W')
    expect(gps?.[piexif.GPSIFD.GPSLongitude]).toEqual([[0, 1], [7, 1], [4020, 100]])
  })
})

describe('insertExif', () => {
  // A minimal but valid 1×1 baseline JPEG (no existing EXIF).
  const jpeg =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8AH//Z'

  it('round-trips the built dict back out of the JPEG', () => {
    const dict = buildExifDict(makeMetadata({ camera_make: 'Fujifilm' }), withMetadata)

    const withExif = insertExif(jpeg, dict)
    const loaded = piexif.load(withExif)

    expect(withExif.startsWith('data:image/jpeg')).toBe(true)
    expect(loaded['0th'][piexif.ImageIFD.Make]).toBe('Fujifilm')
    expect(loaded['Exif'][piexif.ExifIFD.ExposureTime]).toEqual([1, 250])
  })
})
