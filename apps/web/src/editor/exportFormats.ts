export type ExportFormat =
  | 'jpeg' | 'png' | 'webp' | 'avif' | 'jxl' | 'tiff' | 'cube'

export interface FormatCapability {
  format: string
  /** 'native' = canvas; 'wasm' = encoder lazy; 'lut' = salida .cube; 'unsupported'. */
  encoder: 'native' | 'wasm' | 'lut'
  mime?: string          // sólo native/wasm
  /** ¿Respeta el slider de calidad? (PNG/TIFF/cube no) */
  hasQuality: boolean
  hasMetadata: boolean
}

export const FORMAT_CAPS: Record<ExportFormat, FormatCapability> = {
    jpeg: { format: 'JPEG', encoder: 'native', mime: 'image/jpeg', hasQuality: true, hasMetadata: true  },
    png:  { format: 'PNG',  encoder: 'native', mime: 'image/png',  hasQuality: false, hasMetadata: false },
    webp: { format: 'WebP', encoder: 'native', mime: 'image/webp', hasQuality: true, hasMetadata: false },
    avif: { format: 'AVIF', encoder: 'wasm',   mime: 'image/avif', hasQuality: true, hasMetadata: false },
    jxl:  { format: 'JPEG XL', encoder: 'wasm', mime: 'image/jxl', hasQuality: true, hasMetadata: false },
    tiff: { format: 'TIFF', encoder: 'wasm',   mime: 'image/tiff', hasQuality: false, hasMetadata: false },
    cube: { format: 'CUBE LUT', encoder: 'lut', hasQuality: false, hasMetadata: false }, 
}