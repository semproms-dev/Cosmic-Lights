import { useEffect, useState } from 'react'
import { compileCurveTexture } from './curvesMath'
import { WebGLRenderer } from './gl/renderer'
import type { ImageState } from './image'
import { presetAdjustments, presetCurves, type Preset } from './presets'
import { toRenderAdjustments } from './renderAdjustments'
import type { MaskAlphaCache } from './segmentation/types'
import { logger } from '../logger'

/** Ancho del canvas de la miniatura, en píxeles. El alto sale del aspecto. */
const THUMB_WIDTH = 128

/** Lado mayor de la textura fuente, en píxeles. */
const SOURCE_MAX = 320

/**
 * Las miniaturas enseñan el revelado global, sin máscaras: una máscara es
 * trabajo del usuario sobre *esta* foto, no parte de la receta.
 */
const NO_ALPHAS: MaskAlphaCache = new Map()

/** Shared empty result, so "nothing rendered yet" is a stable reference. */
const NO_THUMBNAILS: Map<string, string> = new Map()

/**
 * Las miniaturas publicadas junto a la imagen para la que se revelaron. El par
 * es lo que permite descartarlas al abrir otra foto **durante el render**, sin
 * un `setState` en el efecto que provocaría un segundo render con las anteriores
 * todavía en pantalla.
 */
interface ThumbnailState {
  source: ImageState
  thumbnails: Map<string, string>
}

/**
 * Revela la imagen abierta una vez por preset, fuera de pantalla, y devuelve las
 * miniaturas como data-URLs indexadas por `Preset.id`.
 *
 * Se recalculan solo al cambiar de imagen, **no** al mover un slider: la
 * miniatura enseña a dónde te lleva el preset, no dónde estás. La textura se
 * sube reducida a {@link SOURCE_MAX} y todas las pasadas comparten un único
 * contexto WebGL, así que el catálogo entero cuesta una fracción de un revelado
 * normal.
 *
 * El mapa se publica en cada vuelta, de forma que las filas del panel se van
 * llenando en lugar de aparecer todas de golpe al final.
 *
 * @param presets - Catálogo a previsualizar. Debe ser una referencia estable
 *   (un módulo, o un `useMemo`): es una dependencia del efecto.
 * @param image - Imagen abierta, o `null` si no hay ninguna.
 */
export function usePresetThumbnails(
  presets: Preset[],
  image: ImageState,
): Map<string, string> {
  const [state, setState] = useState<ThumbnailState>({
    source: null,
    thumbnails: NO_THUMBNAILS,
  })

  useEffect(() => {
    if (image === null) return

    let cancelled = false
    let renderer: WebGLRenderer | null = null
    let source: ImageBitmap | null = null

    const build = async (): Promise<void> => {
      try {
        const scale = Math.min(1, SOURCE_MAX / Math.max(image.width, image.height))
        source = await createImageBitmap(image.bitmap, {
          resizeWidth: Math.max(1, Math.round(image.width * scale)),
          resizeHeight: Math.max(1, Math.round(image.height * scale)),
          resizeQuality: 'medium',
        })
        // El efecto ha podido limpiarse mientras se reescalaba el bitmap.
        if (cancelled) return

        const canvas = document.createElement('canvas')
        canvas.width = THUMB_WIDTH
        // El aspecto del canvas tiene que igualar el de la imagen: si no, el
        // letterbox del renderer mete bandas negras dentro de la miniatura.
        canvas.height = Math.max(
          1,
          Math.round((THUMB_WIDTH * source.height) / source.width),
        )

        const gl = canvas.getContext('webgl2')
        if (gl === null) throw new Error('WebGL2 not available')

        renderer = new WebGLRenderer(gl)
        renderer.uploadImage(source)
        renderer.setCrop(null, source.width, source.height)

        const built = new Map<string, string>()
        for (const preset of presets) {
          if (cancelled) return
          renderer.uploadCurves(compileCurveTexture(presetCurves(preset)))
          renderer.render(
            toRenderAdjustments(presetAdjustments({}, preset)),
            [],
            NO_ALPHAS,
            null,
            canvas.width,
            canvas.height,
          )
          built.set(preset.id, canvas.toDataURL('image/jpeg', 0.8))
          setState({ source: image, thumbnails: new Map(built) })
        }
      } catch (error) {
        logger.error('usePresetThumbnails: failed to render preset previews', error)
      } finally {
        renderer?.dispose()
        source?.close()
      }
    }

    void build()

    return () => {
      cancelled = true
    }
  }, [presets, image])

  // Las miniaturas de la imagen anterior no valen para esta: se descartan aquí,
  // no en el efecto, para que nunca lleguen a pintarse bajo la foto nueva.
  return state.source === image ? state.thumbnails : NO_THUMBNAILS
}
