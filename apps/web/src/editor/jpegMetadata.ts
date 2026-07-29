import piexif from 'piexifjs'
import type { GpsData, LensInfo, Metadata } from 'libraw-wasm'
import { logger } from '../logger'

const log = logger.forContext('jpeg.metadata')

/**
 * How much of the file is handed to the parser on the first attempt.
 *
 * EXIF lives in an APP1 segment right at the head of a JPEG (a single segment
 * is capped at 64 KB), so this is generous. The point is not to turn a 40 MB
 * photo into a 40 MB string just to read the camera model.
 */
const EXIF_SCAN_BYTES = 256 * 1024

/** One IFD of a parsed EXIF dictionary, read as unknown (the lib types it `any`). */
type ExifSection = Record<number, unknown>

/**
 * Bytes → the latin-1 "binary string" piexifjs parses. Chunked because spreading
 * a multi-megabyte array into `fromCharCode` blows the call stack.
 */
function toBinaryString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let result = ''
  for (let index = 0; index < bytes.length; index += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return result
}

/** An IFD of the dict, or an empty one when the photo has no such section. */
function section(dict: piexif.ExifDict, name: '0th' | 'Exif' | 'GPS'): ExifSection {
  return (dict[name] ?? {}) as ExifSection
}

/** EXIF strings arrive NUL-padded and often blank; `''` when there is nothing. */
function readString(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\0/g, '').trim() : ''
}

/**
 * A RATIONAL tag (`[numerator, denominator]`) as a plain number — exposure
 * time, f-number, focal length, GPS components.
 *
 * Kept separate from {@link readInteger} on purpose: `[800, 800]` is a valid ISO
 * list *and* a valid rational, so a single reader that guessed from the shape
 * would turn ISO 800 into 1. The tag's type is known here, so nothing is guessed.
 *
 * @returns 0 when absent or unusable, zero denominator included (some bodies
 * write that for "unknown", and it must not become Infinity).
 */
function readRational(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (Array.isArray(value) && value.length >= 2) {
    const [numerator, denominator] = value
    if (typeof numerator === 'number' && typeof denominator === 'number' && denominator !== 0) {
      return numerator / denominator
    }
  }
  return 0
}

/**
 * A SHORT/LONG tag as a number — ISO, pixel dimensions, references.
 *
 * @returns 0 when absent. Some bodies write ISO as a list; the first entry is
 * the one that counts.
 */
function readInteger(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0]
  return 0
}

/** EXIF datetime ("YYYY:MM:DD HH:MM:SS") → Date, or `null` if unparsable. */
function readDate(value: unknown): Date | null {
  const text = readString(value)
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text)
  if (match === null) return null
  const [, year, month, day, hour, minute, second] = match.map(Number)
  const date = new Date(year, month - 1, day, hour, minute, second)
  return Number.isNaN(date.getTime()) ? null : date
}

/** GPS degrees/minutes/seconds, each an EXIF rational. */
function readDms(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null
  return [readRational(value[0]), readRational(value[1]), readRational(value[2])]
}

/** The GPS block LibRaw would have produced, or `undefined` if the photo has none. */
function readGps(gps: ExifSection): GpsData | undefined {
  const latitude = readDms(gps[piexif.GPSIFD.GPSLatitude])
  const longitude = readDms(gps[piexif.GPSIFD.GPSLongitude])
  const latref = readString(gps[piexif.GPSIFD.GPSLatitudeRef])
  const longref = readString(gps[piexif.GPSIFD.GPSLongitudeRef])
  if (latitude === null || longitude === null || latref === '' || longref === '') return undefined
  return {
    latitude,
    longitude,
    altitude: readRational(gps[piexif.GPSIFD.GPSAltitude]),
    latref,
    longref,
    altref: readInteger(gps[piexif.GPSIFD.GPSAltitudeRef]),
    gpsstatus: null,
    // The flag `buildExifDict` gates on: it means "these coordinates are real",
    // which is exactly what having parsed both of them proves.
    gpsparsed: true,
  }
}

/** The lens block, filled from the two EXIF tags that carry one. */
function readLens(exif: ExifSection): LensInfo | undefined {
  const model = readString(exif[piexif.ExifIFD.LensModel])
  const make = readString(exif[piexif.ExifIFD.LensMake])
  if (model === '' && make === '') return undefined
  return {
    Lens: model,
    LensMake: make,
    LensSerial: '',
    InternalLensSerial: '',
    MinFocal: 0,
    MaxFocal: 0,
    MaxAp4MinFocal: 0,
    MaxAp4MaxFocal: 0,
    EXIF_MaxAp: 0,
    FocalLengthIn35mmFormat: readInteger(exif[piexif.ExifIFD.FocalLengthIn35mmFilm]),
    makernotes: {
      Lens: '',
      LensID: 0,
      MinFocal: 0,
      MaxFocal: 0,
      MaxAp: 0,
      MinAp: 0,
      CurFocal: 0,
      CurAp: 0,
      FocalLengthIn35mmFormat: 0,
      MinFocusDistance: 0,
      LensMount: 0,
      CameraMount: 0,
      body: '',
    },
  }
}

/**
 * Shapes a parsed EXIF dictionary like LibRaw's `Metadata`, so the Info panel
 * and the export path cannot tell where a photo came from.
 *
 * Returns `null` when the dictionary carries nothing worth showing — a JPEG
 * stripped of EXIF (a screenshot, an export from another tool) then behaves
 * exactly as before this existed: blank Info, no EXIF block on export.
 *
 * Fields LibRaw derives from the sensor (`raw_width`, margins, `thumb_*`) are
 * zeroed: a JPEG has no such thing, and no reader in the app looks at them. The
 * authoritative pixel size is `LoadedImage.width/height`, taken from the decoded
 * bitmap, not from here.
 *
 * @param dict - A dictionary from `piexif.load`.
 * @returns The metadata, or `null` when there is nothing usable in it.
 */
export function metadataFromExifDict(dict: piexif.ExifDict): Metadata | null {
  const zeroth = section(dict, '0th')
  const exif = section(dict, 'Exif')
  const gps = section(dict, 'GPS')

  const make = readString(zeroth[piexif.ImageIFD.Make])
  const model = readString(zeroth[piexif.ImageIFD.Model])
  const shutter = readRational(exif[piexif.ExifIFD.ExposureTime])
  const aperture = readRational(exif[piexif.ExifIFD.FNumber])
  const iso = readInteger(exif[piexif.ExifIFD.ISOSpeedRatings])
  const focal = readRational(exif[piexif.ExifIFD.FocalLength])
  const lens = readLens(exif)
  const timestamp =
    readDate(exif[piexif.ExifIFD.DateTimeOriginal]) ?? readDate(zeroth[piexif.ImageIFD.DateTime])

  const hasAnything =
    make !== '' || model !== '' || shutter !== 0 || aperture !== 0 || iso !== 0 || focal !== 0
  if (!hasAnything) return null

  return {
    width: readInteger(exif[piexif.ExifIFD.PixelXDimension]),
    height: readInteger(exif[piexif.ExifIFD.PixelYDimension]),
    raw_width: 0,
    raw_height: 0,
    top_margin: 0,
    left_margin: 0,
    // Deliberately 0, never the file's EXIF orientation: that one is already
    // baked into the bitmap by `createImageBitmap(..., 'from-image')`, and a
    // second reader applying it would turn the photo twice.
    flip: 0,
    camera_make: make,
    camera_model: model,
    iso_speed: iso,
    shutter,
    aperture,
    focal_len: focal,
    timestamp: timestamp ?? new Date(0),
    shot_order: 0,
    desc: readString(zeroth[piexif.ImageIFD.ImageDescription]),
    artist: readString(zeroth[piexif.ImageIFD.Artist]),
    thumb_width: 0,
    thumb_height: 0,
    thumb_format: 'unknown',
    software: readString(zeroth[piexif.ImageIFD.Software]),
    gps_data: readGps(gps),
    lens,
  }
}

/**
 * Reads the camera metadata a JPEG carries in its EXIF.
 *
 * Never throws: a photo with no EXIF, a truncated file or a parser that trips
 * over an exotic segment all mean the same thing to the app — no metadata — and
 * none of them is a reason to fail the load of a perfectly good image.
 *
 * @param file - The JPEG the user opened.
 * @returns The metadata, or `null` when the file carries none.
 */
export async function readJpegMetadata(file: File): Promise<Metadata | null> {
  try {
    const head = await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer()
    try {
      return metadataFromExifDict(piexif.load(toBinaryString(head)))
    } catch (error) {
      // The parser walks segments until the start-of-scan marker and throws when
      // it runs off the end, which is what a truncated head looks like to it. A
      // file with a fat ICC profile or thumbnail can push that marker past the
      // cut, so it gets one more go with everything.
      if (file.size <= EXIF_SCAN_BYTES) throw error
      return metadataFromExifDict(piexif.load(toBinaryString(await file.arrayBuffer())))
    }
  } catch (error) {
    log.warn(`No EXIF could be read from ${file.name}: ${String(error)}`)
    return null
  }
}
