import { createProgram, createRenderTarget, deleteRenderTarget } from './glContext'
import type { RenderTarget } from './glContext'
import {
  BLUR_FRAGMENT_SHADER,
  BRUSH_FRAGMENT_SHADER,
  BRUSH_VERTEX_SHADER,
  CLARITY_FRAGMENT_SHADER,
  FRAGMENT_SHADER,
  MASK_FRAGMENT_SHADER,
  VERTEX_SHADER,
} from './shaders'
import { cropToUvTransform } from '../crop'
import type { CropRegion } from '../image'
import { MASK_ADJUSTMENT_KEYS, type BrushMode, type BrushStroke, type Mask, type MaskPoint } from '../masks'

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
  private readonly uCropOffset: WebGLUniformLocation | null
  private readonly uCropScale: WebGLUniformLocation | null
  private readonly uClarityOffset: WebGLUniformLocation | null
  private readonly uDehaze: WebGLUniformLocation | null
  private readonly uTexture: WebGLUniformLocation | null
  private readonly uOverlayMask: WebGLUniformLocation | null
  private readonly uOverlay: WebGLUniformLocation | null

  // Third program: one 1D Gaussian pass, run twice (H then V) for a separable blur.
  private readonly blurProgram: WebGLProgram
  private readonly uBlurScale: WebGLUniformLocation | null
  private readonly uBlurFlipV: WebGLUniformLocation | null
  private readonly uBlurSource: WebGLUniformLocation | null
  private readonly uBlurDirection: WebGLUniformLocation | null
  private readonly uBlurRadius: WebGLUniformLocation | null

  // Fourth program: the per-mask local-adjustment pass. Reads the current
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

  // Fifth program: the brush stamp. Draws soft discs into a mask's alpha target,
  // union-blended to paint or reverse-blended to erase.
  private readonly brushProgram: WebGLProgram
  private readonly uBrushCenter: WebGLUniformLocation | null
  private readonly uBrushRadius: WebGLUniformLocation | null
  private readonly uBrushHardness: WebGLUniformLocation | null

  // Per-mask alpha targets, keyed by mask id, with the mask version they were
  // last rebuilt from (so `syncMasks` only re-rasterises when strokes change).
  private readonly maskTargets = new Map<string, { target: RenderTarget; version: number }>()
  // Second developed target: the mask stacking passes ping-pong between the two.
  private developed2: RenderTarget | null = null
  private cropOffset: [number, number] = [0, 0]
  private cropScale: [number, number] = [1, 1]
  private cropAspect: number | null = null

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
    this.uCropOffset = gl.getUniformLocation(this.clarityProgram, 'uCropOffset')
    this.uCropScale = gl.getUniformLocation(this.clarityProgram, 'uCropScale')
    this.uClarityOffset = gl.getUniformLocation(this.clarityProgram, 'uOffset')
    this.uOverlayMask = gl.getUniformLocation(this.clarityProgram, 'uOverlayMask')
    this.uOverlay = gl.getUniformLocation(this.clarityProgram, 'uOverlay')

    this.blurProgram = createProgram(gl, VERTEX_SHADER, BLUR_FRAGMENT_SHADER)
    this.uBlurScale = gl.getUniformLocation(this.blurProgram, 'uScale')
    this.uBlurFlipV = gl.getUniformLocation(this.blurProgram, 'uFlipV')
    this.uBlurSource = gl.getUniformLocation(this.blurProgram, 'uSource')
    this.uBlurDirection = gl.getUniformLocation(this.blurProgram, 'uDirection')
    this.uBlurRadius = gl.getUniformLocation(this.blurProgram, 'uRadius')

    this.maskProgram = createProgram(gl, VERTEX_SHADER, MASK_FRAGMENT_SHADER)
    this.uMaskScale = gl.getUniformLocation(this.maskProgram, 'uScale')
    this.uMaskOffset = gl.getUniformLocation(this.maskProgram, 'uOffset')
    this.uMaskFlipV = gl.getUniformLocation(this.maskProgram, 'uFlipV')
    this.uMaskImage = gl.getUniformLocation(this.maskProgram, 'uImage')
    this.uMaskTex = gl.getUniformLocation(this.maskProgram, 'uMask')
    this.uMaskInvert = gl.getUniformLocation(this.maskProgram, 'uInvert')
    // One uniform per mask-adjustment key: store key → shader uniform.
    this.maskAdjLoc = Object.fromEntries(
      MASK_ADJUSTMENT_KEYS.map((key) => [
        key,
        gl.getUniformLocation(this.maskProgram, `u${key[0].toUpperCase()}${key.slice(1)}`),
      ]),
    )

    this.brushProgram = createProgram(gl, BRUSH_VERTEX_SHADER, BRUSH_FRAGMENT_SHADER)
    this.uBrushCenter = gl.getUniformLocation(this.brushProgram, 'uCenter')
    this.uBrushRadius = gl.getUniformLocation(this.brushProgram, 'uRadius')
    this.uBrushHardness = gl.getUniformLocation(this.brushProgram, 'uHardness')

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

  setCrop(region: CropRegion | null, imageWidth: number, imageHeight: number) : void {
    if(region === null) {
      this.cropOffset = [0,0];
      this.cropScale = [1,1];
      this.cropAspect = null;
      return;
    }

    const {offsetX, offsetY, scaleX, scaleY} = cropToUvTransform(region, imageWidth, imageHeight);
    this.cropOffset = [offsetX, offsetY];
    this.cropScale = [scaleX, scaleY];
    this.cropAspect = region.width / region.height;
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
   * Reconciles the per-mask alpha targets with the store's masks: creates a
   * target for each new mask, re-rasterises brush masks whose `version` changed,
   * and frees targets for removed masks. Call once per frame before the mask
   * passes. AI masks (no strokes yet) keep an empty target until their bitmap is
   * uploaded, so they simply have no effect for now.
   *
   * @param masks - The store's current masks.
   */
  syncMasks(masks: Mask[]): void {
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
      // Only re-rasterise when the strokes actually changed (version bump). Live
      // painting stamps straight into the target without a bump, so it survives.
      if (entry.version !== mask.version) {
        this.rebuildMaskTarget(entry.target, mask.strokes)
        entry.version = mask.version
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

  render(adjustments: RenderAdjustments, masks: Mask[], overlayMaskId: string | null, canvasWidth: number, canvasHeight: number): void {
    const gl = this.gl
    if (!this.hasImage || this.developed === null || this.developed2 === null || this.blurA === null || this.blurB === null || this.blurC === null || canvasWidth === 0 || canvasHeight === 0) {
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

    // ── Pass 1: run the pixel pipeline into the developed target, at image
    // resolution and filling the whole quad (no letterbox here). ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, developed.framebuffer)
    gl.viewport(0, 0, developed.width, developed.height)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(this.uScale, 1, 1)
    gl.uniform1f(this.uFlipV, 0) // samples the RAW upload: no flip
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
    // Texel size in UV space so the sharpen can reach its neighbours.
    gl.uniform2f(this.uTexel, 1 / this.imageWidth, 1 / this.imageHeight)
    gl.uniform1f(this.uSharpness, adjustments.sharpness)
    gl.uniform1f(this.uThreshold, adjustments.threshold)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.uniform1i(this.uImage, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.curveLut)
    gl.uniform1i(this.uCurveLut, 1)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // ── Mask stacking: re-develop the image once per mask with that mask's own
    // adjustments and blend by its alpha, ping-ponging between the two developed
    // targets. `finalDeveloped` ends up holding the fully-masked result; with no
    // masks it stays the base develop, so the passes below are unchanged. ──
    this.syncMasks(masks)
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
        for (const key of MASK_ADJUSTMENT_KEYS) {
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

    // ── Passes 2-5: two separable Gaussian blurs of the developed image. ──
    // Large (clarity/dehaze) → blurB; small (texture) → blurC. blurA is the
    // shared H-pass scratch, reused once the large blur has consumed it.
    // Skipped when no local-contrast slider is active: the composite is then the
    // identity regardless of the (unused) blur textures, so 4 passes are saved.
    if (adjustments.clarity !== 0 || adjustments.dehaze !== 0 || adjustments.texture !== 0) {
      const texelX = 1 / this.imageWidth
      const texelY = 1 / this.imageHeight
      const largeRadius = 40 // mid-sized structures (clarity/dehaze)
      const smallRadius = 8 // fine detail (texture)
      this.blur1D(finalDeveloped.texture, blurA, texelX, 0, largeRadius)
      this.blur1D(blurA.texture, blurB, 0, texelY, largeRadius)
      this.blur1D(finalDeveloped.texture, blurA, texelX, 0, smallRadius)
      this.blur1D(blurA.texture, blurC, 0, texelY, smallRadius)
    }

    // ── Pass 4: clarity composite (developed + blur) → canvas, letterboxed. ──
    // Shrink the quad on the axis that would otherwise overflow.
    const canvasAspect = canvasWidth / canvasHeight
    // Letterbox against the crop's aspect (not the full frame's) so the cropped
    // region fills the canvas without stretching. Falls back to the full image
    // when there is no crop.
    const imageAspect = this.cropAspect ?? this.imageWidth / this.imageHeight
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
    // Fold the interactive zoom into the letterbox scale and pan via uOffset, so
    // the fitted image scales around the canvas centre before being translated.
    gl.uniform2f(this.uClarityScale, scaleX * this.viewScale, scaleY * this.viewScale)
    gl.uniform2f(this.uClarityOffset, this.viewOffset[0], this.viewOffset[1])
    gl.uniform1f(this.uClarityFlipV, 1) // samples FBO textures: flip to cancel their inversion
    // Non-destructive crop: the shader remaps the quad onto this UV region.
    // Defaults to identity ([0,0]/[1,1]) until setCrop is called, so passing
    // them unconditionally is what keeps the image visible (an unset uScale-like
    // uniform would default to 0 and collapse the sample to a single texel).
    gl.uniform2f(this.uCropOffset, this.cropOffset[0], this.cropOffset[1])
    gl.uniform2f(this.uCropScale, this.cropScale[0], this.cropScale[1])
    gl.uniform1f(this.uClarity, adjustments.clarity)
    gl.uniform1f(this.uDehaze, adjustments.dehaze)
    gl.uniform1f(this.uTexture, adjustments.texture)
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
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, overlayEntry?.target.texture ?? this.texture)
    gl.uniform1i(this.uOverlayMask, 3)
    gl.uniform1f(this.uOverlay, overlayEntry === undefined ? 0 : 1)
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
    this.disposeMaskTargets()
    gl.deleteTexture(this.texture)
    gl.deleteTexture(this.curveLut)
    gl.deleteBuffer(this.buffer)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
    gl.deleteProgram(this.clarityProgram)
    gl.deleteProgram(this.blurProgram)
    gl.deleteProgram(this.maskProgram)
    gl.deleteProgram(this.brushProgram)
  }
}
