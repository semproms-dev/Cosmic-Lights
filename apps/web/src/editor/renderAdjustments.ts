import type { RenderAdjustments } from './gl/renderer'

/**
 * Valor neutro de cada uniform del shader. No todos son 0: el punto medio y el
 * difuminado del viñeteado valen 50, y sembrarlos a 0 pinta un viñeteado duro
 * que nadie ha pedido. Igual con el tamaño y la irregularidad del grano — son
 * la *forma* del grano, no su cantidad; quien lo apaga es `grain = 0`.
 */
const RENDER_DEFAULTS: RenderAdjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  // Grading: lo que apaga una zona es su saturación, así que el tono de al lado
  // da igual mientras esté en 0 — pero tiene que ser un número finito igual.
  gradeShadowHue: 0,
  gradeShadowSat: 0,
  gradeMidHue: 0,
  gradeMidSat: 0,
  gradeHighHue: 0,
  gradeHighSat: 0,
  // La luminancia de cada zona va aparte de la rueda y funciona con el tinte a
  // 0: es como se oscurece una zona sin teñirla.
  gradeShadowLum: 0,
  gradeMidLum: 0,
  gradeHighLum: 0,
  // El difuminado es la *forma* del reparto entre zonas, no su cantidad: neutro
  // en 50, como el punto medio del viñeteado. A 0 las tres zonas se cortan a
  // cuchillo. Todavía no tiene control en el panel; el shader lo espera igual.
  gradeBlending: 50,
  gradeBalance: 0,
  sharpness: 0,
  threshold: 0,
  clarity: 0,
  dehaze: 0,
  texture: 0,
  colorNoise: 0,
  luminanceNoise: 0,
  // El detalle es la *forma* del filtro de luminancia, no su cantidad, igual que
  // el tamaño y la irregularidad del grano: neutro en 50, y quien lo apaga es
  // `luminanceNoise = 0`.
  luminanceDetail: 50,
  vignette: 0,
  vignetteMidpoint: 50,
  vignetteFeather: 50,
  grain: 0,
  grainSize: 50,
  grainRoughness: 50,
}

/**
 * Completa el mapa de sliders del store con los uniforms que el shader espera.
 *
 * Una clave que falte llegaría al shader como `NaN` y tiñe de negro el fotograma
 * entero sin dar ningún error, así que el mapa crudo del store nunca se pasa
 * directamente: todo el que dibuje (lienzo, exportación, miniaturas de presets)
 * entra por aquí.
 *
 * @param values - Valores actuales del store, posiblemente incompletos.
 */
export function toRenderAdjustments(values: Record<string, number>): RenderAdjustments {
  const result = { ...RENDER_DEFAULTS }
  for (const key of Object.keys(RENDER_DEFAULTS) as (keyof RenderAdjustments)[]) {
    const value = values[key]
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value
  }
  return result
}
