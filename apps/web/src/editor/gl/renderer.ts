import { createProgram, createRenderTarget, deleteRenderTarget } from './glContext'
import type { RenderTarget } from './glContext'
import {
  BLUR_FRAGMENT_SHADER,
  BRUSH_FRAGMENT_SHADER,
  BRUSH_VERTEX_SHADER,
  AMOUNT_MAP_FRAGMENT_SHADER,
  AMOUNT_MAP_RANGE,
  CLARITY_FRAGMENT_SHADER,
  DENOISE_FRAGMENT_SHADER,
  FRAGMENT_SHADER,
  GRADIENT_FRAGMENT_SHADER,
  GRADIENT_VERTEX_SHADER,
  MASK_FRAGMENT_SHADER,
  RADIAL_FRAGMENT_SHADER,
  VERTEX_SHADER,
} from './shaders'
import type { CropRegion } from '../image'
import { CHROMA_EDGE_SIGMA, denoiseParams, type DenoiseParams } from '../noise'
import { IDENTITY_ORIENTATION, uvTransform, type Orientation } from '../rotation'
import { MASK_TONE_KEYS, type BrushMode, type BrushStroke, type GradientLine, type Mask, type MaskPoint, type RadialShape } from '../masks'
import type { MaskAlpha, MaskAlphaCache } from '../segmentation/types'

/**
 * The per-frame adjustment values the shader needs, already defaulted (no
 * `undefined`). The host component reads these from the store and fills any
 * missing slider with its zero value before handing them over.
 */
export interface RenderAdjustments {
  /** Exposure in stops; `rgb *= 2^exposure`. */
  exposure: number
  /** Contrast in [-100, 100]; scales rgb around the 0.5 pivot. */
  contrast: number
  /** Highlights in [-100, 100]; luma-masked offset on bright zones. */
  highlights: number
  /** Shadows in [-100, 100]; luma-masked offset on dark zones. */
  shadows: number
  /** Whites in [-100, 100]; luma-masked offset on the brightest extreme. */
  whites: number
  /** Blacks in [-100, 100]; luma-masked offset on the darkest extreme. */
  blacks: number
  /** Temperature in [-100, 100]; blue↔amber channel gains (multiplicative). */
  temperature: number
  /** Tint in [-100, 100]; green↔magenta green-channel gain (multiplicative). */
  tint: number
  /** Vibrance in [-100, 100]; saturation weighted toward muted pixels. */
  vibrance: number
  /** Saturation in [-100, 100]; uniform luma↔color blend. */
  saturation: number
  /** Shadow-zone tint hue in degrees [0, 360]. Inert while its saturation is 0. */
  gradeShadowHue: number
  /** Shadow-zone tint strength in [0, 100]; 0 leaves the zone untinted. */
  gradeShadowSat: number
  /** Shadow-zone brightness in [-100, 100]; weighted offset, works with no tint. */
  gradeShadowLum: number
  /** Midtone-zone tint hue in degrees [0, 360]. */
  gradeMidHue: number
  /** Midtone-zone tint strength in [0, 100]. */
  gradeMidSat: number
  /** Midtone-zone brightness in [-100, 100]. */
  gradeMidLum: number
  /** Highlight-zone tint hue in degrees [0, 360]. */
  gradeHighHue: number
  /** Highlight-zone tint strength in [0, 100]. */
  gradeHighSat: number
  /** Highlight-zone brightness in [-100, 100]. */
  gradeHighLum: number
  /** Zone blending in [0, 100]; how much the three grading zones overlap. Neutral at 50. */
  gradeBlending: number
  /** Zone balance in [-100, 100]; shifts the midpoint between shadows and highlights. */
  gradeBalance: number
  /** Sharpness in [-5, 5]; unsharp-mask amount on luma (negatives soften). */
  sharpness: number
  /** Threshold in [-100, 100]; dead-band that spares sub-threshold detail from the sharpen. */
  threshold: number
  /** Clarity in [-5, 5]; large-radius midtone local-contrast (negatives soften). */
  clarity: number
  /** Dehaze in [-5, 5]; removes atmospheric haze (negatives add it). */
  dehaze: number
  /** Texture in [-5, 5]; small-radius fine-detail local-contrast (negatives soften). */
  texture: number
  /** Colour noise in [0, 100]; chroma denoise before the pipeline (0 = off, and the pass skips). */
  colorNoise: number
  /** Luminance noise in [0, 100]; edge-preserving bilateral on luma (0 = off). */
  luminanceNoise: number
  /** Luminance detail in [0, 100]; how much detail the luma filter gives back (100 = all of it). */
  luminanceDetail: number
  /** Vignette in [-100, 100]; post-crop edge shading. Negative darkens, as in Lightroom. */
  vignette: number
  /** Vignette midpoint in [0, 100]; where the falloff starts (0 = near the centre). */
  vignetteMidpoint: number
  /** Vignette feather in [0, 100]; softness of the falloff (0 = hard edge). */
  vignetteFeather: number
  /** Grain in [0, 100]; film-grain amount (0 = off, and the pass skips it). */
  grain: number
  /** Grain size in [0, 100]; cell size as a fraction of the frame (0 = fine). */
  grainSize: number
  /** Grain roughness in [0, 100]; how clumped the grain is (0 = even). */
  grainRoughness: number
}

/**
 * Owns the WebGL2 resources for the editor pipeline: the program, the geometry
 * (a single full-screen quad) and the image texture. The React layer feeds it
 * the decoded image and the current adjustment values and asks it to draw.
 *
 * The renderer never reads from the store directly; it is a thin, imperative
 * wrapper so the pipeline can grow (more uniforms, passes) without touching the
 * component that hosts it. Curve math stays in the React layer: the host compiles
 * the curves into a flat LUT buffer and hands it over via `uploadCurves`.
 */
export class WebGLRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly buffer: WebGLBuffer
  private readonly texture: WebGLTexture
  // 256×4 R8 tone-curve LUT (one row per channel: master rgb, red, green, blue).
  // Re-uploaded only when the curves change, sampled by the pipeline program.
  private readonly curveLut: WebGLTexture
  private readonly uScale: WebGLUniformLocation | null
  private readonly uFlipV: WebGLUniformLocation | null
  private readonly uImage: WebGLUniformLocation | null
  private readonly uCurveLut: WebGLUniformLocation | null
  private readonly uExposure: WebGLUniformLocation | null
  private readonly uContrast: WebGLUniformLocation | null
  private readonly uHighlights: WebGLUniformLocation | null
  private readonly uShadows: WebGLUniformLocation | null
  private readonly uWhites: WebGLUniformLocation | null
  private readonly uBlacks: WebGLUniformLocation | null
  private readonly uTemperature: WebGLUniformLocation | null
  private readonly uTint: WebGLUniformLocation | null
  private readonly uVibrance: WebGLUniformLocation | null
  private readonly uSaturation: WebGLUniformLocation | null
  // One vec3 per zone — (hue, saturation, luminance) — rather than nine floats:
  // a third of the locations, and it keeps one zone's controls together.
  private readonly uGradeShadow: WebGLUniformLocation | null
  private readonly uGradeMid: WebGLUniformLocation | null
  private readonly uGradeHigh: WebGLUniformLocation | null
  private readonly uGradeBlending: WebGLUniformLocation | null
  private readonly uGradeBalance: WebGLUniformLocation | null
  private readonly uTexel: WebGLUniformLocation | null
  private readonly uSharpness: WebGLUniformLocation | null
  private readonly uThreshold: WebGLUniformLocation | null

  // Second program: the final composite to the canvas — applies clarity by
  // combining the developed image with its blur. Uniform locations are distinct
  // from the pipeline program's (locations are per-program).
  private readonly clarityProgram: WebGLProgram
  private readonly uClarityScale: WebGLUniformLocation | null
  private readonly uClarityFlipV: WebGLUniformLocation | null
  private readonly uClarityDeveloped: WebGLUniformLocation | null
  private readonly uClarityBlur: WebGLUniformLocation | null
  private readonly uClarityBlurSmall: WebGLUniformLocation | null
  private readonly uClarity: WebGLUniformLocation | null
  private readonly uUvMatrix: WebGLUniformLocation | null
  private readonly uUvCenter: WebGLUniformLocation | null
  private readonly uClarityOffset: WebGLUniformLocation | null
  private readonly uDehaze: WebGLUniformLocation | null
  private readonly uTexture: WebGLUniformLocation | null
  private readonly uVignette: WebGLUniformLocation | null
  private readonly uVignetteMid: WebGLUniformLocation | null
  private readonly uVignetteFeather: WebGLUniformLocation | null
  private readonly uFrameAspect: WebGLUniformLocation | null
  private readonly uGrain: WebGLUniformLocation | null
  private readonly uGrainSize: WebGLUniformLocation | null
  private readonly uGrainRoughness: WebGLUniformLocation | null
  private readonly uOverlayMask: WebGLUniformLocation | null
  private readonly uOverlay: WebGLUniformLocation | null
  private readonly uOverlayInvert: WebGLUniformLocation | null
  private readonly uAmountMapTex: WebGLUniformLocation | null
  private readonly uUseAmountMap: WebGLUniformLocation | null
  private readonly uAmountRange: WebGLUniformLocation | null

  // Third program: one 1D Gaussian pass, run twice (H then V) for a separable blur.
  private readonly blurProgram: WebGLProgram
  private readonly uBlurScale: WebGLUniformLocation | null
  private readonly uBlurFlipV: WebGLUniformLocation | null
  private readonly uBlurSource: WebGLUniformLocation | null
  private readonly uBlurDirection: WebGLUniformLocation | null
  private readonly uBlurRadius: WebGLUniformLocation | null

  // Fourth program: noise reduction, one 1D pass run twice (H then V). A sibling
  // of the blur, but it runs two filters off one set of fetches: a wide Gaussian
  // on chroma and an edge-preserving bilateral on luma.
  private readonly denoiseProgram: WebGLProgram
  private readonly uDenoiseScale: WebGLUniformLocation | null
  private readonly uDenoiseFlipV: WebGLUniformLocation | null
  private readonly uDenoiseSource: WebGLUniformLocation | null
  private readonly uDenoiseOriginal: WebGLUniformLocation | null
  private readonly uDenoiseDirection: WebGLUniformLocation | null
  private readonly uDenoiseColorRadius: WebGLUniformLocation | null
  private readonly uDenoiseLumaRadius: WebGLUniformLocation | null
  private readonly uDenoiseEdgeSigma: WebGLUniformLocation | null
  private readonly uDenoiseLumaSigmaRange: WebGLUniformLocation | null
  private readonly uDenoiseDetail: WebGLUniformLocation | null
  private readonly uDenoiseFinal: WebGLUniformLocation | null

  // Fifth program: the per-mask local-adjustment pass. Reads the current
  // developed image + a mask's alpha and blends the mask's tone/colour delta
  // over it. Shares the pipeline VAO (full-screen quad) and vertex shader.
  private readonly maskProgram: WebGLProgram
  private readonly uMaskScale: WebGLUniformLocation | null
  private readonly uMaskOffset: WebGLUniformLocation | null
  private readonly uMaskFlipV: WebGLUniformLocation | null
  private readonly uMaskImage: WebGLUniformLocation | null
  private readonly uMaskTex: WebGLUniformLocation | null
  private readonly uMaskInvert: WebGLUniformLocation | null
  private readonly maskAdjLoc: Record<string, WebGLUniformLocation | null>

  // Sixth program: the local-contrast amount map. Accumulates the global texture
  // slider plus each mask's own into a per-pixel value the composite reads.
  private readonly amountProgram: WebGLProgram
  private readonly uAmountScale: WebGLUniformLocation | null
  private readonly uAmountFlipV: WebGLUniformLocation | null
  private readonly uAmountMaskTex: WebGLUniformLocation | null
  private readonly uAmountValue: WebGLUniformLocation | null
  private readonly uAmountInvert: WebGLUniformLocation | null
  private readonly uAmountUseMask: WebGLUniformLocation | null

  // Seventh program: the brush stamp. Draws soft discs into a mask's alpha target,
  // union-blended to paint or reverse-blended to erase.
  private readonly brushProgram: WebGLProgram
  private readonly uBrushCenter: WebGLUniformLocation | null
  private readonly uBrushRadius: WebGLUniformLocation | null
  private readonly uBrushHardness: WebGLUniformLocation | null

  // Eighth program: the linear-gradient rasteriser. Fills a mask's alpha target
  // with a ramp described by two image-space points (full-effect and zero-effect
  // lines). Shares the full-screen quad VAO; no vertex uniforms.
  private readonly gradientProgram: WebGLProgram
  private readonly uGradP1: WebGLUniformLocation | null
  private readonly uGradP2: WebGLUniformLocation | null
  private readonly uGradImageSize: WebGLUniformLocation | null

  // Ninth program: the radial-gradient rasteriser. Fills a mask's alpha target
  // with an elliptical falloff (centre, semi-axes, rotation). Shares the
  // full-screen quad VAO and the gradient vertex shader; no vertex uniforms.
  private readonly radialProgram: WebGLProgram
  private readonly uRadCenter: WebGLUniformLocation | null
  private readonly uRadRadii: WebGLUniformLocation | null
  private readonly uRadRotation: WebGLUniformLocation | null
  private readonly uRadFeather: WebGLUniformLocation | null
  private readonly uRadImageSize: WebGLUniformLocation | null

  // Per-mask alpha targets, keyed by mask id, with the mask version they were
  // last rebuilt from (so `syncMasks` only re-rasterises when strokes change).
  private readonly maskTargets = new Map<string, { target: RenderTarget; version: number }>()
  // Second developed target: the mask stacking passes ping-pong between the two.
  private developed2: RenderTarget | null = null
  // Crop and orientation are stored as source data rather than as ready-made
  // uniforms: they fold into a single transform that neither can build alone,
  // and either setter may be the one called last. `render` combines them.
  private cropRegion: CropRegion | null = null
  private cropImageSize: [number, number] | null = null
  private orientation: Orientation = IDENTITY_ORIENTATION

  // Interactive view (zoom/pan), applied to the final composite on top of the
  // letterbox. viewScale multiplies the fit-to-canvas scale; viewOffset pans the
  // result in clip space. Identity (1 / [0,0]) shows the whole image fitted.
  private viewScale = 1
  private viewOffset: [number, number] = [0, 0]

  // The developed image (tone/colour/details) rendered off-screen, so later
  // passes can sample it. Recreated whenever the image size changes.
  private developed: RenderTarget | null = null
  // Blur targets: blurA is shared scratch for the H pass; blurB holds the large
  // blur (clarity/dehaze), blurC the small blur (texture).
  private blurA: RenderTarget | null = null
  private blurB: RenderTarget | null = null
  private blurC: RenderTarget | null = null
  // Output of the noise-reduction pass, which feeds the pipeline in place of the
  // uploaded texture. Only one new target is needed: the separable pass borrows
  // `blurA` as its horizontal scratch, which is free at that point because the
  // clarity blurs do not run until later in the frame.
  private denoised: RenderTarget | null = null
  // Per-pixel local-contrast amount (currently just texture), built only when a
  // mask actually carries one. Positive contributions accumulate in .r and
  // negative ones in .g; the composite takes the difference.
  private amountMap: RenderTarget | null = null
  // Which parameters `denoised` currently holds the result for, or null when it
  // holds nothing usable. The denoise is the one pass whose output depends solely
  // on its own sliders, so this key is all it takes to skip it on every frame
  // driven by any other control. Cleared in `uploadImage` — a new image is the
  // one input to the pass that the key itself does not describe.
  private denoiseKey: string | null = null

  private imageWidth = 0
  private imageHeight = 0
  private hasImage = false

  /**
   * Builds the program, uploads the quad geometry and prepares an (empty)
   * image texture. The canvas must already have a live WebGL2 context.
   *
   * @param gl - The WebGL2 context from the host canvas.
   */
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)

    // A quad spanning clip space, drawn as a triangle strip.
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
    const buffer = gl.createBuffer()
    const vao = gl.createVertexArray()
    if (buffer === null || vao === null) {
      throw new Error('Failed to create geometry buffers')
    }
    this.buffer = buffer
    this.vao = vao
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(this.program, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    const texture = gl.createTexture()
    if (texture === null) {
      throw new Error('Failed to create texture')
    }
    this.texture = texture
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    // Tone-curve LUT texture. Single-channel (R8), 256 input entries × 4 channel
    // rows, LINEAR so lookups interpolate smoothly between entries. Seeded with an
    // identity ramp so the pipeline is a passthrough until the host uploads curves.
    const curveLut = gl.createTexture()
    if (curveLut === null) {
      throw new Error('Failed to create curve LUT texture')
    }
    this.curveLut = curveLut
    gl.bindTexture(gl.TEXTURE_2D, curveLut)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const identityLut = new Uint8Array(256 * 4)
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 256; i++) {
        identityLut[row * 256 + i] = i
      }
    }
    // R8 rows are 256 bytes, but set UNPACK_ALIGNMENT to 1 to be format-agnostic,
    // and FLIP_Y to false so channel rows are not swapped (uploadImage sets it true).
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 4, 0, gl.RED, gl.UNSIGNED_BYTE, identityLut)

    this.uScale = gl.getUniformLocation(this.program, 'uScale')
    this.uFlipV = gl.getUniformLocation(this.program, 'uFlipV')
    this.uImage = gl.getUniformLocation(this.program, 'uImage')
    this.uCurveLut = gl.getUniformLocation(this.program, 'uCurveLut')
    this.uExposure = gl.getUniformLocation(this.program, 'uExposure')
    this.uContrast = gl.getUniformLocation(this.program, 'uContrast')
    this.uHighlights = gl.getUniformLocation(this.program, 'uHighlights')
    this.uShadows = gl.getUniformLocation(this.program, 'uShadows')
    this.uWhites = gl.getUniformLocation(this.program, 'uWhites')
    this.uBlacks = gl.getUniformLocation(this.program, 'uBlacks')
    this.uTemperature = gl.getUniformLocation(this.program, 'uTemperature')
    this.uTint = gl.getUniformLocation(this.program, 'uTint')
    this.uVibrance = gl.getUniformLocation(this.program, 'uVibrance')
    this.uSaturation = gl.getUniformLocation(this.program, 'uSaturation')
    this.uGradeShadow = gl.getUniformLocation(this.program, 'uGradeShadow')
    this.uGradeMid = gl.getUniformLocation(this.program, 'uGradeMid')
    this.uGradeHigh = gl.getUniformLocation(this.program, 'uGradeHigh')
    this.uGradeBlending = gl.getUniformLocation(this.program, 'uGradeBlending')
    this.uGradeBalance = gl.getUniformLocation(this.program, 'uGradeBalance')
    this.uTexel = gl.getUniformLocation(this.program, 'uTexel')
    this.uSharpness = gl.getUniformLocation(this.program, 'uSharpness')
    this.uThreshold = gl.getUniformLocation(this.program, 'uThreshold')

    this.clarityProgram = createProgram(gl, VERTEX_SHADER, CLARITY_FRAGMENT_SHADER)
    this.uClarityScale = gl.getUniformLocation(this.clarityProgram, 'uScale')
    this.uClarityFlipV = gl.getUniformLocation(this.clarityProgram, 'uFlipV')
    this.uClarityDeveloped = gl.getUniformLocation(this.clarityProgram, 'uDeveloped')
    this.uClarityBlur = gl.getUniformLocation(this.clarityProgram, 'uBlur')
    this.uClarityBlurSmall = gl.getUniformLocation(this.clarityProgram, 'uBlurSmall')
    this.uClarity = gl.getUniformLocation(this.clarityProgram, 'uClarity')
    this.uDehaze = gl.getUniformLocation(this.clarityProgram, 'uDehaze')
    this.uTexture = gl.getUniformLocation(this.clarityProgram, 'uTexture')
    this.uVignette = gl.getUniformLocation(this.clarityProgram, 'uVignette')
    this.uVignetteMid = gl.getUniformLocation(this.clarityProgram, 'uVignetteMid')
    this.uVignetteFeather = gl.getUniformLocation(this.clarityProgram, 'uVignetteFeather')
    this.uFrameAspect = gl.getUniformLocation(this.clarityProgram, 'uFrameAspect')
    this.uGrain = gl.getUniformLocation(this.clarityProgram, 'uGrain')
    this.uGrainSize = gl.getUniformLocation(this.clarityProgram, 'uGrainSize')
    this.uGrainRoughness = gl.getUniformLocation(this.clarityProgram, 'uGrainRoughness')
    this.uUvMatrix = gl.getUniformLocation(this.clarityProgram, 'uUvMatrix')
    this.uUvCenter = gl.getUniformLocation(this.clarityProgram, 'uUvCenter')
    this.uClarityOffset = gl.getUniformLocation(this.clarityProgram, 'uOffset')
    this.uOverlayMask = gl.getUniformLocation(this.clarityProgram, 'uOverlayMask')
    this.uOverlay = gl.getUniformLocation(this.clarityProgram, 'uOverlay')
    this.uOverlayInvert = gl.getUniformLocation(this.clarityProgram, 'uOverlayInvert')
    this.uAmountMapTex = gl.getUniformLocation(this.clarityProgram, 'uAmountMap')
    this.uUseAmountMap = gl.getUniformLocation(this.clarityProgram, 'uUseAmountMap')
    this.uAmountRange = gl.getUniformLocation(this.clarityProgram, 'uAmountRange')

    this.blurProgram = createProgram(gl, VERTEX_SHADER, BLUR_FRAGMENT_SHADER)
    this.uBlurScale = gl.getUniformLocation(this.blurProgram, 'uScale')
    this.uBlurFlipV = gl.getUniformLocation(this.blurProgram, 'uFlipV')
    this.uBlurSource = gl.getUniformLocation(this.blurProgram, 'uSource')
    this.uBlurDirection = gl.getUniformLocation(this.blurProgram, 'uDirection')
    this.uBlurRadius = gl.getUniformLocation(this.blurProgram, 'uRadius')

    this.denoiseProgram = createProgram(gl, VERTEX_SHADER, DENOISE_FRAGMENT_SHADER)
    this.uDenoiseScale = gl.getUniformLocation(this.denoiseProgram, 'uScale')
    this.uDenoiseFlipV = gl.getUniformLocation(this.denoiseProgram, 'uFlipV')
    this.uDenoiseSource = gl.getUniformLocation(this.denoiseProgram, 'uSource')
    this.uDenoiseOriginal = gl.getUniformLocation(this.denoiseProgram, 'uOriginal')
    this.uDenoiseDirection = gl.getUniformLocation(this.denoiseProgram, 'uDirection')
    this.uDenoiseColorRadius = gl.getUniformLocation(this.denoiseProgram, 'uColorRadius')
    this.uDenoiseLumaRadius = gl.getUniformLocation(this.denoiseProgram, 'uLumaRadius')
    this.uDenoiseEdgeSigma = gl.getUniformLocation(this.denoiseProgram, 'uEdgeSigma')
    this.uDenoiseLumaSigmaRange = gl.getUniformLocation(this.denoiseProgram, 'uLumaSigmaRange')
    this.uDenoiseDetail = gl.getUniformLocation(this.denoiseProgram, 'uDetail')
    this.uDenoiseFinal = gl.getUniformLocation(this.denoiseProgram, 'uFinal')

    this.maskProgram = createProgram(gl, VERTEX_SHADER, MASK_FRAGMENT_SHADER)
    this.uMaskScale = gl.getUniformLocation(this.maskProgram, 'uScale')
    this.uMaskOffset = gl.getUniformLocation(this.maskProgram, 'uOffset')
    this.uMaskFlipV = gl.getUniformLocation(this.maskProgram, 'uFlipV')
    this.uMaskImage = gl.getUniformLocation(this.maskProgram, 'uImage')
    this.uMaskTex = gl.getUniformLocation(this.maskProgram, 'uMask')
    this.uMaskInvert = gl.getUniformLocation(this.maskProgram, 'uInvert')
    // One uniform per mask-adjustment key: store key → shader uniform.
    this.maskAdjLoc = Object.fromEntries(
      MASK_TONE_KEYS.map((key) => [
        key,
        gl.getUniformLocation(this.maskProgram, `u${key[0].toUpperCase()}${key.slice(1)}`),
      ]),
    )

    this.amountProgram = createProgram(gl, VERTEX_SHADER, AMOUNT_MAP_FRAGMENT_SHADER)
    this.uAmountScale = gl.getUniformLocation(this.amountProgram, 'uScale')
    this.uAmountFlipV = gl.getUniformLocation(this.amountProgram, 'uFlipV')
    this.uAmountMaskTex = gl.getUniformLocation(this.amountProgram, 'uMask')
    this.uAmountValue = gl.getUniformLocation(this.amountProgram, 'uAmount')
    this.uAmountInvert = gl.getUniformLocation(this.amountProgram, 'uInvert')
    this.uAmountUseMask = gl.getUniformLocation(this.amountProgram, 'uUseMask')

    this.brushProgram = createProgram(gl, BRUSH_VERTEX_SHADER, BRUSH_FRAGMENT_SHADER)
    this.uBrushCenter = gl.getUniformLocation(this.brushProgram, 'uCenter')
    this.uBrushRadius = gl.getUniformLocation(this.brushProgram, 'uRadius')
    this.uBrushHardness = gl.getUniformLocation(this.brushProgram, 'uHardness')

    this.gradientProgram = createProgram(gl, GRADIENT_VERTEX_SHADER, GRADIENT_FRAGMENT_SHADER)
    this.uGradP1 = gl.getUniformLocation(this.gradientProgram, 'uP1')
    this.uGradP2 = gl.getUniformLocation(this.gradientProgram, 'uP2')
    this.uGradImageSize = gl.getUniformLocation(this.gradientProgram, 'uImageSize')

    this.radialProgram = createProgram(gl, GRADIENT_VERTEX_SHADER, RADIAL_FRAGMENT_SHADER)
    this.uRadCenter = gl.getUniformLocation(this.radialProgram, 'uCenter')
    this.uRadRadii = gl.getUniformLocation(this.radialProgram, 'uRadii')
    this.uRadRotation = gl.getUniformLocation(this.radialProgram, 'uRotation')
    this.uRadFeather = gl.getUniformLocation(this.radialProgram, 'uFeather')
    this.uRadImageSize = gl.getUniformLocation(this.radialProgram, 'uImageSize')

    gl.clearColor(0, 0, 0, 0)
  }

  /**
   * Uploads the decoded image to the GPU texture. Call this only when the image
   * itself changes, not on every adjustment.
   *
   * @param bitmap - The decoded frame to draw.
   */
  uploadImage(bitmap: ImageBitmap): void {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    // Flip vertically on upload so texture V=1 is the image's top row. With this
    // done once here, no shader needs to flip, which keeps orientation
    // consistent across the multi-pass (FBO) pipeline.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
    this.imageWidth = bitmap.width
    this.imageHeight = bitmap.height
    this.hasImage = true

    // The off-screen targets live at image resolution; rebuild on size change.
    if (this.developed !== null) {
      deleteRenderTarget(gl, this.developed)
    }
    if (this.blurA !== null) {
      deleteRenderTarget(gl, this.blurA)
    }
    if (this.blurB !== null) {
      deleteRenderTarget(gl, this.blurB)
    }
    if (this.blurC !== null) {
      deleteRenderTarget(gl, this.blurC)
    }
    if (this.developed2 !== null) {
      deleteRenderTarget(gl, this.developed2)
    }
    if (this.denoised !== null) {
      deleteRenderTarget(gl, this.denoised)
    }
    if (this.amountMap !== null) {
      deleteRenderTarget(gl, this.amountMap)
    }
    this.amountMap = createRenderTarget(gl, bitmap.width, bitmap.height)
    this.denoised = createRenderTarget(gl, bitmap.width, bitmap.height)
    // The cached denoise belongs to the previous image; the sliders may not have
    // moved, but the pixels underneath them have.
    this.denoiseKey = null
    this.developed = createRenderTarget(gl, bitmap.width, bitmap.height)
    this.developed2 = createRenderTarget(gl, bitmap.width, bitmap.height)
    this.blurA = createRenderTarget(gl, bitmap.width, bitmap.height)
    this.blurB = createRenderTarget(gl, bitmap.width, bitmap.height)
    this.blurC = createRenderTarget(gl, bitmap.width, bitmap.height)
    // Mask alpha targets are image-sized too; drop them so they rebuild fresh
    // against the new image (the store clears masks on load in any case).
    this.disposeMaskTargets()
  }

  /**
   * Uploads a generated alpha into a mask's target, replacing whatever it held.
   *
   * The target is reallocated at the alpha's own resolution, which need not be
   * the image's: the mask pass samples it with normalised UVs and LINEAR
   * filtering, so a smaller alpha is stretched by the GPU for free.
   *
   * Does **not** touch `entry.version` — {@link syncMasks} owns that bookkeeping.
   *
   * @param maskId - The mask to fill. Unknown ids are ignored (no target yet).
   * @param maskAlpha - The weight map, one byte per pixel.
   */
  uploadMaskAlpha(maskId: string, maskAlpha: MaskAlpha): void {
    const entry = this.maskTargets.get(maskId)
    if (entry === undefined) return
    const gl = this.gl
    const { width, height, data } = maskAlpha

    // The target is RGBA8 and the mask shader reads the weight from `.r`, so the
    // single channel is expanded into R and the rest left at zero.
    const rgba = new Uint8Array(width * height * 4)
    for (let index = 0; index < width * height; index++) {
      rgba[index * 4] = data[index]
    }

    gl.bindTexture(gl.TEXTURE_2D, entry.target.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
    entry.target.width = width
    entry.target.height = height
  }

  /**
   * Uploads the compiled tone-curve LUTs to the GPU. Call only when the curves
   * change, not on every adjustment. The buffer is the flat 256×4 R8 layout from
   * `compileCurveTexture` (row 0 = master rgb, rows 1–3 = red/green/blue).
   *
   * @param data - `256 * 4` bytes, row-major, each entry an output value 0..255.
   */
  uploadCurves(data: Uint8Array): void {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.curveLut)
    // Match the R8 upload state from the constructor: tight rows, no vertical flip
    // (uploadImage leaves FLIP_Y true, which would swap the channel rows).
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 4, 0, gl.RED, gl.UNSIGNED_BYTE, data)
  }

  /**
   * Sets the crop region for the next frame, or `null` for the full frame. The
   * crop is non-destructive: it only changes which part of the developed texture
   * the composite samples.
   *
   * @param region - The crop in image pixels, or `null` for the whole image.
   * @param imageWidth - Full image width in pixels, the region's frame of reference.
   * @param imageHeight - Full image height in pixels.
   */
  setCrop(region: CropRegion | null, imageWidth: number, imageHeight: number) : void {
    this.cropRegion = region
    this.cropImageSize = [imageWidth, imageHeight]
  }

  /**
   * Sets the 90° turns and mirroring applied to the image for the next frame.
   * Like the crop, it is a remap of the composite's sampling coordinates — no
   * pixels move and nothing is re-uploaded, so it is free to change per frame.
   *
   * Defaults to {@link IDENTITY_ORIENTATION}, so a caller that never touches
   * this renders exactly as before.
   *
   * @param orientation - The turns and flips to display.
   */
  setOrientation(orientation: Orientation): void {
    this.orientation = orientation
  }

  /**
   * Sets the interactive view transform (zoom/pan) for the next frame. Applied
   * to the final composite on top of the letterbox: the fitted image is scaled
   * by `scale` around the canvas centre and translated by the clip-space offset.
   *
   * @param scale - Zoom multiplier over the fit-to-canvas size (1 = fitted).
   * @param offsetX - Horizontal pan in clip space (−1..1 spans the canvas width).
   * @param offsetY - Vertical pan in clip space (−1..1 spans the canvas height).
   */
  setView(scale: number, offsetX: number, offsetY: number): void {
    this.viewScale = scale;
    this.viewOffset = [offsetX, offsetY];
  }

  /**
   * Draws the current image with the given adjustments into the canvas at the
   * given backing-store size. Fits the image to the canvas, preserving aspect.
   *
   * @param adjustments - The defaulted per-frame adjustment values.
   * @param canvasWidth - Canvas backing-store width in device pixels.
   * @param canvasHeight - Canvas backing-store height in device pixels.
   */
  /**
   * Runs one 1D Gaussian pass: blurs `sourceTexture` along `(dirX, dirY)` into
   * `target`. Composed twice (H then V) it yields a separable 2D blur.
   *
   * @param sourceTexture - The texture to blur (a previous pass's FBO texture).
   * @param target - The render target to write the blurred result into.
   * @param dirX - Per-texel step on X (1/width for a horizontal pass, else 0).
   * @param dirY - Per-texel step on Y (1/height for a vertical pass, else 0).
   * @param radius - Blur radius in texels (≈ 3·sigma).
   */
  private blur1D(sourceTexture: WebGLTexture, target: RenderTarget, dirX: number, dirY: number, radius: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.viewport(0, 0, target.width, target.height)
    gl.useProgram(this.blurProgram)
    gl.uniform2f(this.uBlurScale, 1, 1)
    gl.uniform1f(this.uBlurFlipV, 1) // samples an FBO texture
    gl.uniform2f(this.uBlurDirection, dirX, dirY)
    gl.uniform1f(this.uBlurRadius, radius)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture)
    gl.uniform1i(this.uBlurSource, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /**
   * Runs one 1D denoise pass: filters `sourceTexture` along `(dirX, dirY)` into
   * `target`. Composed twice (H then V) it approximates a separable 2D chroma
   * blur and luminance bilateral.
   *
   * A bilateral is not separable in the strict sense, so running it H-then-V is
   * an approximation. At these radii (≤ 6 texels) the artefact is invisible, and
   * it turns a cost of `(2r+1)²` taps into `2·(2r+1)`.
   *
   * Unlike {@link blur1D} this sets `uFlipV = 0` on both passes, which makes the
   * pair an exact identity mapping of texture coordinates (`target[t]` comes from
   * `source[t]`). That is deliberate, and it buys two things: `denoised` carries
   * the *same* orientation as the uploaded texture it replaces, so the pipeline
   * pass keeps `uFlipV = 0` whether or not the denoise ran; and `uOriginal` can be
   * sampled at the very same `vUv` as `uSource` on the final pass, with no
   * coordinate correction to get wrong.
   *
   * @param sourceTexture - The texture to filter.
   * @param target - The render target to write the filtered result into.
   * @param dirX - Per-texel step on X (1/width for a horizontal pass, else 0).
   * @param dirY - Per-texel step on Y (1/height for a vertical pass, else 0).
   * @param params - The frame's denoise parameters, from `denoiseParams`.
   * @param isFinal - True on the vertical pass, the one that applies `detail`.
   */
  private denoise1D(
    sourceTexture: WebGLTexture,
    target: RenderTarget,
    dirX: number,
    dirY: number,
    params: DenoiseParams,
    isFinal: boolean,
  ): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.viewport(0, 0, target.width, target.height)
    gl.useProgram(this.denoiseProgram)
    gl.uniform2f(this.uDenoiseScale, 1, 1)
    gl.uniform1f(this.uDenoiseFlipV, 0) // identity mapping; see the note above
    gl.uniform2f(this.uDenoiseDirection, dirX, dirY)
    gl.uniform1f(this.uDenoiseColorRadius, params.colorRadius)
    gl.uniform1f(this.uDenoiseLumaRadius, params.lumaRadius)
    gl.uniform1f(this.uDenoiseEdgeSigma, CHROMA_EDGE_SIGMA)
    gl.uniform1f(this.uDenoiseLumaSigmaRange, params.lumaSigmaRange)
    gl.uniform1f(this.uDenoiseDetail, params.detail)
    gl.uniform1f(this.uDenoiseFinal, isFinal ? 1 : 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture)
    gl.uniform1i(this.uDenoiseSource, 0)
    // The untouched image, for the detail mix. Bound on both passes even though
    // only the final one reads it: leaving the sampler pointing at whatever unit
    // was last used is how a "why is it sampling itself" bug gets written.
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.uniform1i(this.uDenoiseOriginal, 1)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /**
   * Builds the per-pixel texture-amount map: the global slider, plus each mask's
   * own texture weighted by that mask's alpha.
   *
   * One trivial draw per contribution, accumulated with additive blending, and
   * no neighbourhood sampling anywhere — that is what keeps a local Texture from
   * costing two extra full-resolution blur passes per mask.
   *
   * Signs are split across two channels because the target is RGBA8 and a
   * normalised target cannot hold a negative: positives land in `.r`, negatives
   * in `.g`, and the composite subtracts. The framebuffer's own saturation at 1.0
   * is then exactly the ±`AMOUNT_MAP_RANGE` clamp, for free.
   *
   * @param masks - The mask stack, in draw order.
   * @param globalTexture - The global Texture slider, which is the map's base.
   * @param target - The map to fill.
   */
  private buildAmountMap(masks: Mask[], globalTexture: number, target: RenderTarget): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.viewport(0, 0, target.width, target.height)
    // Start from nothing: every contribution below is added onto this. Set
    // explicitly rather than trusting the context-wide clear colour, since this
    // pass is the one place where a non-zero one would silently bias the result.
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.amountProgram)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(this.uAmountScale, 1, 1)
    // Alphas are stored in the same orientation as `developed`, and this map is
    // read by the composite alongside it, so no flip on either side.
    gl.uniform1f(this.uAmountFlipV, 0)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE)

    // The global slider first, at full weight everywhere.
    gl.uniform1f(this.uAmountUseMask, 0)
    gl.uniform1f(this.uAmountValue, globalTexture)
    gl.uniform1f(this.uAmountInvert, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // Then one draw per mask that actually carries a texture delta.
    gl.uniform1f(this.uAmountUseMask, 1)
    gl.activeTexture(gl.TEXTURE0)
    for (const mask of masks) {
      const amount = mask.adjustments.texture ?? 0
      if (amount === 0) continue
      const entry = this.maskTargets.get(mask.id)
      if (entry === undefined) continue
      gl.uniform1f(this.uAmountValue, amount)
      gl.uniform1f(this.uAmountInvert, mask.invert ? 1 : 0)
      gl.bindTexture(gl.TEXTURE_2D, entry.target.texture)
      gl.uniform1i(this.uAmountMaskTex, 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    gl.disable(gl.BLEND)
  }

  /** Frees every per-mask alpha target and empties the map. */
  private disposeMaskTargets(): void {
    for (const entry of this.maskTargets.values()) {
      deleteRenderTarget(this.gl, entry.target)
    }
    this.maskTargets.clear()
  }

  /**
   * Sets the GPU blend state for a brush stamp. `add` unions coverage into the
   * mask (`dst = max(src, dst)`); `erase` carves it out (`dst *= 1 - srcA`).
   */
  private setBrushBlend(mode: BrushMode): void {
    const gl = this.gl
    gl.enable(gl.BLEND)
    if (mode === 'erase') {
      gl.blendEquation(gl.FUNC_ADD)
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA)
    } else {
      gl.blendEquation(gl.MAX)
      gl.blendFunc(gl.ONE, gl.ONE)
    }
  }

  /**
   * Stamps soft discs along a polyline into the currently-bound mask target.
   * Points are in image pixels; discs are spaced ≈ a quarter radius so a fast
   * drag still lays a continuous line. Assumes the target framebuffer/viewport
   * are already bound.
   */
  private stampDiscsAlong(points: MaskPoint[], radius: number, hardness: number, mode: BrushMode): void {
    const gl = this.gl
    if (points.length === 0) return
    gl.useProgram(this.brushProgram)
    gl.bindVertexArray(this.vao)
    gl.uniform1f(this.uBrushHardness, hardness)
    gl.uniform2f(this.uBrushRadius, (radius / this.imageWidth) * 2, (radius / this.imageHeight) * 2)
    this.setBrushBlend(mode)

    const stampAt = (px: number, py: number): void => {
      // Image px → clip. Y matches `developed`'s stored orientation (v=0 = image
      // top), so a painted point lands at the same place the composite shows it.
      gl.uniform2f(this.uBrushCenter, (px / this.imageWidth) * 2 - 1, (py / this.imageHeight) * 2 - 1)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    const spacing = Math.max(1, radius * 0.25)
    if (points.length === 1) {
      stampAt(points[0].x, points[0].y)
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / spacing))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        stampAt(a.x + dx * t, a.y + dy * t)
      }
    }

    gl.disable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD) // restore the default for any later blended pass
    gl.bindVertexArray(null)
  }

  /** Clears a mask target and re-stamps every stroke from scratch. */
  private rebuildMaskTarget(target: RenderTarget, strokes: BrushStroke[]): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.viewport(0, 0, target.width, target.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    for (const stroke of strokes) {
      this.stampDiscsAlong(stroke.points, stroke.radius, stroke.hardness, stroke.mode)
    }
  }

  /**
   * Clears a mask target and rasterises a linear gradient into it. A `null`
   * gradient (a freshly created mask, before the first drag) leaves the target
   * empty — the correct render of "no gradient yet".
   *
   * @param target - The mask alpha target to overwrite.
   * @param gradient - The ramp, in image pixels, or `null` for an empty mask.
   */
  private rebuildGradientTarget(target: RenderTarget, gradient: GradientLine | null): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.viewport(0, 0, target.width, target.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (gradient === null) return

    // The ramp overwrites the whole target, so blending must be off — otherwise
    // it would composite against the cleared contents. Set it explicitly rather
    // than trusting whatever the previous pass left.
    gl.disable(gl.BLEND)
    gl.useProgram(this.gradientProgram)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(this.uGradP1, gradient.x1, gradient.y1)
    gl.uniform2f(this.uGradP2, gradient.x2, gradient.y2)
    gl.uniform2f(this.uGradImageSize, this.imageWidth, this.imageHeight)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  /**
   * Clears a mask target and rasterises a radial (elliptical) gradient into it.
   * A `null` shape (a freshly created mask, before the first drag) leaves the
   * target empty — the correct render of "no shape yet".
   *
   * @param target - The mask alpha target to overwrite.
   * @param radial - The ellipse, in image pixels, or `null` for an empty mask.
   */
  private rebuildRadialTarget(target: RenderTarget, radial: RadialShape | null): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.viewport(0, 0, target.width, target.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (radial === null) return

    // The ellipse overwrites the whole target, so blending must be off — same as
    // the linear ramp: otherwise it would composite against the cleared contents.
    gl.disable(gl.BLEND)
    gl.useProgram(this.radialProgram)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(this.uRadCenter, radial.cx, radial.cy)
    gl.uniform2f(this.uRadRadii, radial.rx, radial.ry)
    gl.uniform1f(this.uRadRotation, radial.rotation)
    gl.uniform1f(this.uRadFeather, radial.feather)
    gl.uniform2f(this.uRadImageSize, this.imageWidth, this.imageHeight)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  /**
   * Reconciles the per-mask alpha targets with the store's masks: creates a
   * target for each new mask, re-rasterises brush masks whose `version` changed,
   * and frees targets for removed masks. Call once per frame before the mask
   * passes. An AI mask whose alpha has not arrived yet keeps an empty target —
   * and a stale version, so it is retried on the next frame.
   *
   * @param masks - The store's current masks.
   * @param maskAlphas - Generated alphas for AI masks, keyed by mask id. An
   * entry appears only once its segmentation resolves, and is only fresh while
   * its `version` matches the mask's.
   */
  syncMasks(masks: Mask[], maskAlphas: MaskAlphaCache): void {
    const gl = this.gl
    if (!this.hasImage) return
    const live = new Set(masks.map((mask) => mask.id))
    for (const [id, entry] of this.maskTargets) {
      if (!live.has(id)) {
        deleteRenderTarget(gl, entry.target)
        this.maskTargets.delete(id)
      }
    }
    for (const mask of masks) {
      let entry = this.maskTargets.get(mask.id)

      if (entry === undefined) {
        entry = { target: createRenderTarget(gl, this.imageWidth, this.imageHeight), version: -1 }
        this.maskTargets.set(mask.id, entry)
      }
      // Only reconcile when something actually changed (version bump). Live
      // painting stamps straight into the target without a bump, so it survives.
      // Each branch marks its own work done, so a mask still waiting on its alpha
      // keeps a stale version and gets retried next frame.
      if (entry.version !== mask.version) {
        switch (mask.type) {
          case 'brush':
            this.rebuildMaskTarget(entry.target, mask.strokes)
            entry.version = mask.version
            break
          case 'linear':
            // Rasterised synchronously from 4 numbers: nothing to wait for, so
            // mark the version done unconditionally. A `null` gradient renders as
            // an empty target — the right result. (Leaving the version stale here,
            // as the AI branch does, would retry every frame forever.)
            this.rebuildGradientTarget(entry.target, mask.gradient)
            entry.version = mask.version
            break
          case 'radial':
            // Same story as `linear`: rasterised synchronously from 5 numbers,
            // nothing to wait for, so mark the version done unconditionally. A
            // `null` shape renders as an empty target — the right result.
            this.rebuildRadialTarget(entry.target, mask.radial)
            entry.version = mask.version
            break
          default: {
            // subject/sky/object: the alpha arrives asynchronously from the segmentation
            // worker. Until it does, leave the target empty and the version stale
            // so the next frame tries again.
            const alpha = maskAlphas.get(mask.id)
            if (alpha !== undefined && alpha.version === mask.version) {
              this.uploadMaskAlpha(mask.id, alpha)
              entry.version = mask.version
            }
          }
        }
      }
    }
  }

  /**
   * Live-paints one brush segment straight into a mask's alpha target, without
   * touching the store. Used during a drag for immediate feedback; the stroke is
   * committed (and the target authoritatively rebuilt) on pointer-up.
   *
   * @param maskId - The mask being painted.
   * @param from - Segment start in image pixels.
   * @param to - Segment end in image pixels.
   * @param radius - Brush radius in image pixels.
   * @param hardness - Edge softness, 0..1.
   * @param mode - Paint (`add`) or erase.
   */
  paintSegment(
    maskId: string,
    from: MaskPoint,
    to: MaskPoint,
    radius: number,
    hardness: number,
    mode: BrushMode,
  ): void {
    const entry = this.maskTargets.get(maskId)
    if (entry === undefined) return
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.target.framebuffer)
    gl.viewport(0, 0, entry.target.width, entry.target.height)
    this.stampDiscsAlong([from, to], radius, hardness, mode)
  }

  render(adjustments: RenderAdjustments, masks: Mask[], maskAlphas: MaskAlphaCache, overlayMaskId: string | null, canvasWidth: number, canvasHeight: number): void {
    const gl = this.gl
    if (!this.hasImage || this.developed === null || this.developed2 === null || this.blurA === null || this.blurB === null || this.blurC === null || this.denoised === null || this.amountMap === null || canvasWidth === 0 || canvasHeight === 0) {
      // Nothing to draw: just clear the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvasWidth, canvasHeight)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return
    }
    const developed = this.developed
    const blurA = this.blurA
    const blurB = this.blurB
    const blurC = this.blurC
    const denoised = this.denoised
    const amountMap = this.amountMap

    // ── Pass 0: noise reduction, feeding the pipeline instead of the uploaded
    // texture. It runs FIRST because everything downstream amplifies noise:
    // exposure and shadows multiply it, clarity and the sharpen then lift
    // whatever survived. Denoise-then-sharpen is also the only order that works —
    // sharpening first turns noise into detail the filter can no longer tell
    // apart. Skipped entirely at 0, exactly like the clarity blurs below. ──
    const noise = denoiseParams(adjustments)
    let pipelineSource = this.texture
    if (noise.enabled) {
      // CACHED, and this is what makes the feature usable rather than just
      // correct. Alone in this pipeline, the denoise depends on nothing but its
      // own three sliders — not exposure, not curves, not crop, not masks — so
      // dragging any *other* slider reuses last frame's result and pays nothing.
      // Only moving a noise slider (or loading an image, which clears the key)
      // re-runs the passes. Without this, every frame would pay for the widest
      // filter in the pipeline.
      const key = `${noise.colorRadius}|${noise.lumaRadius}|${noise.lumaSigmaRange}|${noise.detail}`
      if (this.denoiseKey !== key) {
        // blur1D and the pipeline pass bind the VAO themselves further down, but
        // this pass runs before either of them.
        gl.bindVertexArray(this.vao)
        this.denoise1D(this.texture, blurA, 1 / this.imageWidth, 0, noise, false)
        this.denoise1D(blurA.texture, denoised, 0, 1 / this.imageHeight, noise, true)
        this.denoiseKey = key
      }
      pipelineSource = denoised.texture
    }

    // ── Pass 1: run the pixel pipeline into the developed target, at image
    // resolution and filling the whole quad (no letterbox here). ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, developed.framebuffer)
    gl.viewport(0, 0, developed.width, developed.height)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(this.uScale, 1, 1)
    // No flip either way: pass 0 preserves the uploaded texture's orientation, so
    // this is correct whether `pipelineSource` is the upload or the denoised FBO.
    gl.uniform1f(this.uFlipV, 0)
    gl.uniform1f(this.uExposure, adjustments.exposure)
    gl.uniform1f(this.uContrast, adjustments.contrast)
    gl.uniform1f(this.uHighlights, adjustments.highlights)
    gl.uniform1f(this.uShadows, adjustments.shadows)
    gl.uniform1f(this.uWhites, adjustments.whites)
    gl.uniform1f(this.uBlacks, adjustments.blacks)
    gl.uniform1f(this.uTemperature, adjustments.temperature)
    gl.uniform1f(this.uTint, adjustments.tint)
    gl.uniform1f(this.uVibrance, adjustments.vibrance)
    gl.uniform1f(this.uSaturation, adjustments.saturation)
    gl.uniform3f(
      this.uGradeShadow,
      adjustments.gradeShadowHue,
      adjustments.gradeShadowSat,
      adjustments.gradeShadowLum,
    )
    gl.uniform3f(this.uGradeMid, adjustments.gradeMidHue, adjustments.gradeMidSat, adjustments.gradeMidLum)
    gl.uniform3f(
      this.uGradeHigh,
      adjustments.gradeHighHue,
      adjustments.gradeHighSat,
      adjustments.gradeHighLum,
    )
    gl.uniform1f(this.uGradeBlending, adjustments.gradeBlending)
    gl.uniform1f(this.uGradeBalance, adjustments.gradeBalance)
    // Texel size in UV space so the sharpen can reach its neighbours.
    gl.uniform2f(this.uTexel, 1 / this.imageWidth, 1 / this.imageHeight)
    gl.uniform1f(this.uSharpness, adjustments.sharpness)
    gl.uniform1f(this.uThreshold, adjustments.threshold)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, pipelineSource)
    gl.uniform1i(this.uImage, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.curveLut)
    gl.uniform1i(this.uCurveLut, 1)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // ── Mask stacking: re-develop the image once per mask with that mask's own
    // adjustments and blend by its alpha, ping-ponging between the two developed
    // targets. `finalDeveloped` ends up holding the fully-masked result; with no
    // masks it stays the base develop, so the passes below are unchanged. ──
    this.syncMasks(masks, maskAlphas)
    let finalDeveloped = developed
    if (masks.length > 0) {
      let src = developed
      let dst: RenderTarget = this.developed2
      gl.useProgram(this.maskProgram)
      gl.bindVertexArray(this.vao)
      gl.uniform2f(this.uMaskScale, 1, 1)
      gl.uniform2f(this.uMaskOffset, 0, 0)
      // No flip: this pass samples `developed` and its mask at the same vUv and
      // writes developed2 as a straight in-place copy, so with an empty mask it
      // is a no-op (developed2[v] == developed[v]) and the image never flips.
      gl.uniform1f(this.uMaskFlipV, 0)
      for (const mask of masks) {
        const entry = this.maskTargets.get(mask.id)
        if (entry === undefined) continue
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer)
        gl.viewport(0, 0, dst.width, dst.height)
        gl.uniform1f(this.uMaskInvert, mask.invert ? 1 : 0)
        // Tone keys only: `texture` is a mask adjustment too, but this shader
        // cannot apply it (it needs a blur). It rides to the composite instead,
        // through the amount map built below.
        for (const key of MASK_TONE_KEYS) {
          gl.uniform1f(this.maskAdjLoc[key], mask.adjustments[key] ?? 0)
        }
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, src.texture)
        gl.uniform1i(this.uMaskImage, 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, entry.target.texture)
        gl.uniform1i(this.uMaskTex, 1)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        // The result becomes the source for the next mask (ping-pong).
        const tmp = src
        src = dst
        dst = tmp
      }
      finalDeveloped = src
    }

    // A mask carrying its own Texture needs the same small blur the global
    // slider does, so it has to count towards the skip below — otherwise the
    // composite would sample a `blurC` left over from an earlier frame.
    const hasMaskTexture = masks.some((mask) => (mask.adjustments.texture ?? 0) !== 0)

    // ── Passes 2-5: two separable Gaussian blurs of the developed image. ──
    // Large (clarity/dehaze) → blurB; small (texture) → blurC. blurA is the
    // shared H-pass scratch, reused once the large blur has consumed it.
    // Skipped when no local-contrast slider is active: the composite is then the
    // identity regardless of the (unused) blur textures, so 4 passes are saved.
    if (adjustments.clarity !== 0 || adjustments.dehaze !== 0 || adjustments.texture !== 0 || hasMaskTexture) {
      const texelX = 1 / this.imageWidth
      const texelY = 1 / this.imageHeight
      const largeRadius = 40 // mid-sized structures (clarity/dehaze)
      const smallRadius = 8 // fine detail (texture)
      this.blur1D(finalDeveloped.texture, blurA, texelX, 0, largeRadius)
      this.blur1D(blurA.texture, blurB, 0, texelY, largeRadius)
      this.blur1D(finalDeveloped.texture, blurA, texelX, 0, smallRadius)
      this.blur1D(blurA.texture, blurC, 0, texelY, smallRadius)
    }

    // ── Amount map: only when a mask carries a Texture of its own. With none,
    // the composite keeps reading the plain `uTexture` uniform and this whole
    // branch — a target and one draw per contribution — never happens. ──
    if (hasMaskTexture) {
      this.buildAmountMap(masks, adjustments.texture, amountMap)
    }

    // ── Pass 4: clarity composite (developed + blur) → canvas, letterboxed. ──
    // Shrink the quad on the axis that would otherwise overflow.
    const canvasAspect = canvasWidth / canvasHeight
    // Fold the crop and the orientation into the one UV remap the shader applies.
    // Falls back to the uploaded image's size until `setCrop` has run.
    const [transformWidth, transformHeight] = this.cropImageSize ?? [this.imageWidth, this.imageHeight]
    const uv = uvTransform(this.orientation, this.cropRegion, transformWidth, transformHeight)
    // Letterbox against the aspect as *displayed* (not the full frame's) so the
    // cropped region fills the canvas without stretching. A quarter turn stands
    // the frame on its end, so this is where a portrait/landscape swap lands.
    const imageAspect = uv.displayedAspect
    let scaleX = 1
    let scaleY = 1
    if (imageAspect > canvasAspect) {
      scaleY = canvasAspect / imageAspect
    } else {
      scaleX = imageAspect / canvasAspect
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvasWidth, canvasHeight)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.clarityProgram)
    // Bind the quad explicitly instead of inheriting whatever the previous pass
    // left bound. It used to come for free from pass 1, which made inserting a
    // pass in between (the amount map) enough to blank the canvas: no vertex
    // array means no attributes, nothing rasterised, and only the clear colour
    // reaches the screen — with no GL error to point at it.
    gl.bindVertexArray(this.vao)
    // Fold the interactive zoom into the letterbox scale and pan via uOffset, so
    // the fitted image scales around the canvas centre before being translated.
    gl.uniform2f(this.uClarityScale, scaleX * this.viewScale, scaleY * this.viewScale)
    gl.uniform2f(this.uClarityOffset, this.viewOffset[0], this.viewOffset[1])
    gl.uniform1f(this.uClarityFlipV, 1) // samples FBO textures: flip to cancel their inversion
    // Non-destructive crop + orientation: the shader remaps the quad onto this
    // UV region. Defaults to the identity transform until setCrop is called, so
    // passing them unconditionally is what keeps the image visible (an unset
    // matrix uniform would default to 0 and collapse the sample to a texel).
    gl.uniformMatrix2fv(this.uUvMatrix, false, uv.matrix)
    gl.uniform2f(this.uUvCenter, uv.center[0], uv.center[1])
    gl.uniform1f(this.uClarity, adjustments.clarity)
    gl.uniform1f(this.uDehaze, adjustments.dehaze)
    gl.uniform1f(this.uTexture, adjustments.texture)
    // Post-crop vignette. `imageAspect` is the *displayed* aspect, so it already
    // carries the crop and the quarter-turn axis swap — never rebuild it from
    // imageWidth/imageHeight or the oval stretches on a rotated frame.
    gl.uniform1f(this.uVignette, adjustments.vignette)
    gl.uniform1f(this.uVignetteMid, adjustments.vignetteMidpoint)
    gl.uniform1f(this.uVignetteFeather, adjustments.vignetteFeather)
    gl.uniform1f(this.uFrameAspect, imageAspect)
    // Film grain. No extra pass and no size to compute here: the shader sizes
    // the cells as a fraction of the frame (and squares them with the same
    // `imageAspect`), which is what keeps the preview, the export and the preset
    // thumbnails looking alike no matter what resolution each one renders at.
    gl.uniform1f(this.uGrain, adjustments.grain)
    gl.uniform1f(this.uGrainSize, adjustments.grainSize)
    gl.uniform1f(this.uGrainRoughness, adjustments.grainRoughness)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, finalDeveloped.texture)
    gl.uniform1i(this.uClarityDeveloped, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, blurB.texture)
    gl.uniform1i(this.uClarityBlur, 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, blurC.texture)
    gl.uniform1i(this.uClarityBlurSmall, 2)
    // Mask-editing overlay: tint the active mask's painted area so it's visible
    // regardless of its adjustments. Bind its alpha (or the image as a harmless
    // stand-in when there's no overlay) and gate with uOverlay.
    const overlayEntry = overlayMaskId === null ? undefined : this.maskTargets.get(overlayMaskId)
    const overlayMask = overlayMaskId === null ? undefined : masks.find((m) => m.id === overlayMaskId)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, overlayEntry?.target.texture ?? this.texture)
    gl.uniform1i(this.uOverlayMask, 3)
    gl.uniform1f(this.uOverlay, overlayEntry === undefined ? 0 : 1)
    gl.uniform1f(this.uOverlayInvert, overlayMask !== undefined && overlayMask.invert ? 1 : 0)
    // Local Texture. The map already folds the global slider in, so `uTexture`
    // above is ignored while it is in use; bind the image as a harmless
    // stand-in otherwise, exactly as the overlay does.
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, hasMaskTexture ? amountMap.texture : this.texture)
    gl.uniform1i(this.uAmountMapTex, 4)
    gl.uniform1f(this.uUseAmountMap, hasMaskTexture ? 1 : 0)
    gl.uniform1f(this.uAmountRange, AMOUNT_MAP_RANGE)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  /** Releases every GL resource. Call when the host canvas unmounts. */
  dispose(): void {
    const gl = this.gl
    if (this.developed !== null) {
      deleteRenderTarget(gl, this.developed)
    }
    if (this.blurA !== null) {
      deleteRenderTarget(gl, this.blurA)
    }
    if (this.blurB !== null) {
      deleteRenderTarget(gl, this.blurB)
    }
    if (this.blurC !== null) {
      deleteRenderTarget(gl, this.blurC)
    }
    if (this.developed2 !== null) {
      deleteRenderTarget(gl, this.developed2)
    }
    if (this.denoised !== null) {
      deleteRenderTarget(gl, this.denoised)
    }
    if (this.amountMap !== null) {
      deleteRenderTarget(gl, this.amountMap)
    }
    this.disposeMaskTargets()
    gl.deleteTexture(this.texture)
    gl.deleteTexture(this.curveLut)
    gl.deleteBuffer(this.buffer)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
    gl.deleteProgram(this.clarityProgram)
    gl.deleteProgram(this.blurProgram)
    gl.deleteProgram(this.denoiseProgram)
    gl.deleteProgram(this.maskProgram)
    gl.deleteProgram(this.amountProgram)
    gl.deleteProgram(this.brushProgram)
  }
}
