import { buildDefaultCurves } from './curves'
import type { ChannelId, Curves } from './curves'

/**
 * Familia de un preset: la carpeta del panel en la que cae. Es una clave i18n
 * bajo `presets.kind`, no un nombre visible — la carpeta se traduce, el preset
 * que hay dentro no.
 *
 * Cada una responde a una pregunta distinta: `style` es el acabado general,
 * `color` la dominante, `bw` la conversión a monocromo, `lights` el reparto de
 * luces y sombras (sin tocar el color) y `movies` la imitación de una película
 * concreta. Un preset entra en `movies` solo si copia un título identificable;
 * si el look es genérico, es `style`.
 */
export type PresetKind = 'style' | 'color' | 'bw' | 'lights' | 'movies'

/**
 * Orden en el que se pintan las carpetas. Fijo y explícito: el orden del
 * catálogo mandaría la familia del primer preset arriba del todo, y reordenar
 * una receta movería carpetas enteras sin querer.
 */
export const PRESET_KINDS: PresetKind[] = ['style', 'color', 'bw', 'lights', 'movies']

/**
 * Una receta de revelado guardada.
 *
 * Solo lista los ajustes que *toca*: al aplicarla, el resto de sliders vuelve a
 * su valor por defecto, de modo que el resultado no depende de lo que hubiera
 * antes — que es justo lo que promete la miniatura del panel.
 */
export interface Preset {
  /** Identidad estable; es la clave de la miniatura y del resaltado del panel. */
  id: string
  /** Nombre mostrado. Los de fábrica llevan nombre propio y **no** se traducen. */
  name: string
  kind: PresetKind
  /** Los sliders que redefine, indexados por `SliderOption.key`. */
  adjustments: Record<string, number>
  /** Canales de curva que redefine; los no listados quedan en la identidad. */
  curves?: Partial<Curves>
}

/**
 * Curva en S suave: sube el contraste sin tocar el slider de contraste, que
 * pivota sobre 0.5 y apaga las luces altas antes de llegar aquí.
 */
const S_CURVE = [
  { x: 0, y: 0 },
  { x: 64, y: 52 },
  { x: 192, y: 205 },
  { x: 255, y: 255 },
]

/** Catálogo de fábrica. Referencia estable: el hook de miniaturas depende de ella. */
export const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'cinematic',
    name: 'Cinematic',
    kind: 'style',
    adjustments: {
      contrast: 18,
      highlights: -30,
      shadows: 22,
      blacks: -12,
      temperature: -8,
      saturation: -6,
      vignette: -18,
    },
    curves: { rgb: S_CURVE },
  },
  {
    id: 'teal-orange',
    name: 'Urban Teal & Orange',
    kind: 'color',
    adjustments: {
      temperature: 14,
      tint: -6,
      vibrance: 24,
      saturation: -8,
      contrast: 12,
      shadows: 15,
    },
    // Sombras hacia el azul y luces hacia el ámbar: el split-toning clásico,
    // hecho con la curva del canal azul porque no hay ruedas de color todavía.
    curves: {
      blue: [
        { x: 0, y: 18 },
        { x: 128, y: 124 },
        { x: 255, y: 240 },
      ],
    },
  },
  {
    id: 'black-white',
    name: 'Black & White',
    kind: 'bw',
    // Conversión limpia: quitar el color y nada más. Es la base neutra desde la
    // que revelar a mano, no un look — para eso está `dramatic-bw`.
    adjustments: { saturation: -100 },
  },
  {
    id: 'dramatic-bw',
    name: 'Dramatic B&W',
    kind: 'bw',
    adjustments: {
      saturation: -100,
      contrast: 32,
      clarity: 1.4,
      blacks: -22,
      whites: 14,
      vignette: -28,
    },
    curves: { rgb: S_CURVE },
  },
  {
    id: 'vintage-film',
    name: 'Vintage Film',
    kind: 'style',
    adjustments: {
      contrast: -10,
      blacks: 18,
      whites: -8,
      temperature: 10,
      vibrance: -12,
      texture: -0.6,
    },
    // Negros levantados y blancos rebajados: el rango comprimido del papel.
    curves: {
      rgb: [
        { x: 0, y: 22 },
        { x: 128, y: 132 },
        { x: 255, y: 238 },
      ],
    },
  },
  {
    id: 'obsession',
    name: 'Obsession',
    kind: 'movies',
    // Lectura del trabajo de Taylor Clemons: subexposición llevada al límite,
    // sombras opresivas *con* detalle (nada de negros embarrados) y una
    // dominante marrón sucia — cálida en el matiz, verdosa en el tinte — que es
    // lo que separa esto de un simple fotograma oscuro.
    adjustments: {
      exposure: -0.6,
      contrast: 14,
      highlights: -22,
      shadows: -26,
      whites: -14,
      blacks: -18,
      temperature: 12,
      // Hacia el verde, no hacia el magenta: el cálido solo da ámbar, y el
      // ámbar con verde es lo que da el marrón enfermizo de la referencia.
      tint: -8,
      vibrance: -16,
      // Contenida, no lavada: los rojos tienen que seguir leyéndose.
      saturation: -18,
      clarity: 0.8,
      texture: 0.3,
      dehaze: 0.6,
      vignette: -28,
      vignetteMidpoint: 45,
      vignetteFeather: 60,
    },
    curves: {
      // Pie hundido y hombro rebajado: nada llega a blanco, pero el pie no se
      // aplasta contra el cero — la disciplina de exposición del rodaje era
      // justamente conservar información dentro de la sombra.
      rgb: [
        { x: 0, y: 0 },
        { x: 48, y: 32 },
        { x: 160, y: 158 },
        { x: 255, y: 236 },
      ],
      // Azul levantado en el pie y rebajado arriba: sombras frías bajo luces
      // cálidas, que es lo que impide que el marrón se coma el fotograma entero.
      blue: [
        { x: 0, y: 14 },
        { x: 128, y: 116 },
        { x: 255, y: 230 },
      ],
    },
  },
  {
    id: 'interstellar-dust',
    name: 'Interstellar — Dust Bowl',
    kind: 'movies',
    // La mitad terrestre del díptico de Hoytema: ocre, verdes secos y el velo
    // del polvo en suspensión, sobre negativo Kodak — de ahí el contraste
    // contenido y el pie levantado, nada de negros duros.
    adjustments: {
      exposure: 0.1,
      contrast: -6,
      highlights: -14,
      shadows: 12,
      whites: -8,
      blacks: 10,
      temperature: 14,
      // Hacia el verde: el maíz de la película es caqui, no esmeralda.
      tint: -6,
      vibrance: -6,
      saturation: -12,
      // El polvo se lleva por delante el microcontraste y vela las luces.
      clarity: -0.3,
      texture: 0.2,
      dehaze: -0.4,
      vignette: -10,
      vignetteMidpoint: 55,
      vignetteFeather: 70,
    },
    curves: {
      rgb: [
        { x: 0, y: 14 },
        { x: 64, y: 66 },
        { x: 192, y: 196 },
        { x: 255, y: 246 },
      ],
      blue: [
        { x: 0, y: 8 },
        { x: 128, y: 120 },
        { x: 255, y: 238 },
      ],
    },
  },
  {
    id: 'interstellar-void',
    name: 'Interstellar — Void',
    kind: 'movies',
    // La mitad espacial: frío, casi monocromo y con negro de verdad. Es el
    // reverso exacto del anterior — el mismo rodaje, la decisión contraria.
    adjustments: {
      exposure: -0.25,
      contrast: 22,
      highlights: -10,
      shadows: -20,
      whites: 6,
      blacks: -24,
      temperature: -18,
      tint: 2,
      vibrance: -10,
      // Muy baja, pero no cero: lo poco que sobrevive es el ámbar de los
      // paneles de instrumentos, y eso es justo lo que hace la imagen.
      saturation: -30,
      clarity: 0.5,
      texture: 0.2,
      dehaze: 0.4,
      vignette: -20,
      vignetteMidpoint: 50,
      vignetteFeather: 65,
    },
    curves: {
      rgb: [
        { x: 0, y: 0 },
        { x: 64, y: 52 },
        { x: 192, y: 206 },
        { x: 255, y: 255 },
      ],
      blue: [
        { x: 0, y: 10 },
        { x: 128, y: 136 },
        { x: 255, y: 255 },
      ],
    },
  },
  {
    id: 'moody-forest',
    name: 'Moody Forest',
    kind: 'color',
    adjustments: {
      exposure: -0.3,
      temperature: -14,
      tint: 12,
      shadows: -14,
      vibrance: 16,
      dehaze: 0.8,
    },
  },
  {
    id: 'high-key',
    name: 'High Key',
    kind: 'lights',
    // Todo hacia arriba y contraste fuera: la sombra deja de existir. El color
    // no se toca salvo la pizca de saturación que se lleva el aclarado.
    adjustments: {
      exposure: 0.6,
      contrast: -18,
      highlights: -10,
      shadows: 30,
      whites: 12,
      blacks: 18,
      saturation: -6,
      // Positivo aclara los bordes (signo Lightroom): el viñeteado invertido
      // remata el fondo hasta el blanco.
      vignette: 10,
      vignetteMidpoint: 50,
      vignetteFeather: 75,
    },
  },
  {
    id: 'low-key',
    name: 'Low Key',
    kind: 'lights',
    // El reverso: casi todo en sombra y un solo golpe de luz. Sin dominante —
    // lo que ordena la imagen es el reparto, no el matiz.
    adjustments: {
      exposure: -0.7,
      contrast: 24,
      highlights: -20,
      shadows: -30,
      whites: -6,
      blacks: -22,
      clarity: 0.4,
      vignette: -35,
      vignetteMidpoint: 40,
      vignetteFeather: 55,
    },
    curves: {
      rgb: [
        { x: 0, y: 0 },
        { x: 72, y: 44 },
        { x: 200, y: 210 },
        { x: 255, y: 255 },
      ],
    },
  },
  {
    id: 'backlight-rescue',
    name: 'Backlight Rescue',
    kind: 'lights',
    // Para el contraluz: cielo quemado y sujeto en sombra. Los dos extremos se
    // van al centro y el microcontraste devuelve el cuerpo que se pierde al
    // comprimir tanto rango.
    adjustments: {
      exposure: 0.2,
      contrast: 8,
      highlights: -60,
      shadows: 55,
      whites: -10,
      blacks: 8,
      vibrance: 8,
      clarity: 0.5,
      dehaze: 0.4,
    },
  },
]

/**
 * Reparte los presets en sus carpetas: las familias van en el orden fijo de
 * {@link PRESET_KINDS} y, dentro de cada una, los presets conservan el orden del
 * catálogo. Una familia sin presets no aparece — una carpeta vacía solo invita a
 * abrirla para nada.
 *
 * @param presets - Catálogo a agrupar.
 */
export function groupPresets(presets: Preset[]): Map<PresetKind, Preset[]> {
  const groups = new Map<PresetKind, Preset[]>()
  for (const kind of PRESET_KINDS) {
    const bucket = presets.filter((preset) => preset.kind === kind)
    if (bucket.length > 0) groups.set(kind, bucket)
  }
  return groups
}

/**
 * Ajustes resultantes de aplicar un preset sobre `base`.
 *
 * `base` son los valores **por defecto**, no los actuales: un preset reemplaza
 * el revelado global en vez de acumularse sobre él. Si se acumulara, el mismo
 * preset daría un resultado distinto según lo que hubiera antes y la miniatura
 * del panel mentiría.
 *
 * @param base - Valores de partida, normalmente `buildInitialAdjustments()`.
 * @param preset - La receta a aplicar.
 */
export function presetAdjustments(
  base: Record<string, number>,
  preset: Preset,
): Record<string, number> {
  return { ...base, ...preset.adjustments }
}

/**
 * Curvas resultantes de un preset: identidad en todo canal que no redefina.
 *
 * Los puntos se copian porque el store los muta al arrastrarlos en el panel de
 * curvas, y el catálogo es un módulo compartido: sin la copia, editar la curva
 * una vez cambiaría el preset para el resto de la sesión.
 *
 * @param preset - La receta de la que sacar las curvas.
 */
export function presetCurves(preset: Preset): Curves {
  const curves = buildDefaultCurves()
  for (const [channel, points] of Object.entries(preset.curves ?? {})) {
    curves[channel as ChannelId] = points.map((point) => ({ ...point }))
  }
  return curves
}
