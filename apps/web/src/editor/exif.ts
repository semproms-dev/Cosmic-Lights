import piexif from 'piexifjs'
import type { Metadata } from 'libraw-wasm'
import { formatShutterSpeedRational } from '../utils'

export interface ExifOptions {
    includeMetadata: boolean
    includeGPS: boolean
}

/** Decimal → EXIF rational [numerator, denominator] (aperture, focal length…). */
const toRational = (value: number, precision = 10): [number, number] =>
  [Math.round(value * precision), precision]

/** Date → EXIF datetime string "YYYY:MM:DD HH:MM:SS" (note the colons in the date). */
const exifDate = (d: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

/**
 * 
 * @param metadata 
 * @param opts 
 * @returns A dictionary with the metadata requested by the user in the export panel
 * 
 * IFD0 (also called "0th" or "TIFF"): 
 * camera identification, software, the author, copyright, image description, and the modification date.
 */
export const buildExifDict = (metadata: Metadata, opts: ExifOptions): piexif.ExifDict => {
    const dict : piexif.ExifDict = {'0th': {}, 'Exif': {}};

    const dmsToRational = ([deg, min, sec]: [number, number, number]): [number, number][] => [[deg, 1], [min, 1], [Math.round(sec * 100), 100]]   // segundos con 2 decimales

    if(dict['0th']) {
        dict['0th'][piexif.ImageIFD.Make] = metadata.camera_make
        dict['0th'][piexif.ImageIFD.Model] = metadata.camera_model
        dict['0th'][piexif.ImageIFD.Orientation] = 1          // ← NUNCA metadata.flip (§7)
        dict['0th'][piexif.ImageIFD.Software] = metadata.software ?? 'CosmicLights'
        if (metadata.artist) dict['0th'][piexif.ImageIFD.Artist] = metadata.artist
    }

    if(dict['Exif']) {
        dict['Exif'][piexif.ExifIFD.ExposureTime] = formatShutterSpeedRational(metadata.shutter);
        dict['Exif'][piexif.ExifIFD.FNumber] = toRational(metadata.aperture)
        dict['Exif'][piexif.ExifIFD.FocalLength] = toRational(metadata.focal_len)
        dict['Exif'][piexif.ExifIFD.ISOSpeedRatings] = metadata.iso_speed
        dict['Exif'][piexif.ExifIFD.DateTimeOriginal] = exifDate(metadata.timestamp)
    }

    const gps = metadata.gps_data;

    if(opts.includeGPS && gps?.gpsparsed && gps.latref && gps.longref) {
        dict['GPS'] = {
            [piexif.GPSIFD.GPSLatitudeRef] : gps.latref,
            [piexif.GPSIFD.GPSLatitude]: dmsToRational(gps.latitude),
            [piexif.GPSIFD.GPSLongitudeRef]: gps.longref,
            [piexif.GPSIFD.GPSLongitude]:    dmsToRational(gps.longitude),
        }
    }


    return dict;
}

export const insertExif = (jpegDataUrl: string, dict: piexif.ExifDict): string =>
  piexif.insert(piexif.dump(dict), jpegDataUrl)