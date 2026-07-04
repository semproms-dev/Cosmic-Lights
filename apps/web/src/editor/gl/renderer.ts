import { createProgram, createRenderTarget, deleteRenderTarget } from './glContext'
import type { RenderTarget } from './glContext'
import { BLUR_FRAGMENT_SHADER, CLARITY_FRAGMENT_SHADER, FRAGMENT_SHADER, VERTEX_SHADER } from './shaders'

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
  private readonly uDehaze: WebGLUniformLocation | null
  private readonly uTexture: WebGLUniformLocation | null

  // Third program: one 1D Gaussian pass, run twice (H then V) for a separable blur.
  private readonly blurProgram: WebGLProgram
  private readonly uBlurScale: WebGLUniformLocation | null
  private readonly uBlurFlipV: WebGLUniformLocation | null
  private readonly uBlurSource: WebGLUniformLocation | null
  private readonly uBlurDirection: WebGLUniformLocation | null
  private readonly uBlurRadius: WebGLUniformLocation | null

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

    this.blurProgram = createProgram(gl, VERTEX_SHADER, BLUR_FRAGMENT_SHADER)
    this.uBlurScale = gl.getUniformLocation(this.blurProgram, 'uScale')
    this.uBlurFlipV = gl.getUniformLocation(this.blurProgram, 'uFlipV')
    this.uBlurSource = gl.getUniformLocation(this.blurProgram, 'uSource')
    this.uBlurDirection = gl.getUniformLocation(this.blurProgram, 'uDirection')
    this.uBlurRadius = gl.getUniformLocation(this.blurProgram, 'uRadius')

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
    this.developed = createRenderTarget(gl, bitmap.width, bitmap.height)
    this.blurA = createRenderTarget(gl, bitmap.width, bitmap.height)
    this.blurB = createRenderTarget(gl, bitmap.width, bitmap.height)
    this.blurC = createRenderTarget(gl, bitmap.width, bitmap.height)
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

  render(adjustments: RenderAdjustments, canvasWidth: number, canvasHeight: number): void {
    const gl = this.gl
    if (!this.hasImage || this.developed === null || this.blurA === null || this.blurB === null || this.blurC === null || canvasWidth === 0 || canvasHeight === 0) {
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
      this.blur1D(developed.texture, blurA, texelX, 0, largeRadius)
      this.blur1D(blurA.texture, blurB, 0, texelY, largeRadius)
      this.blur1D(developed.texture, blurA, texelX, 0, smallRadius)
      this.blur1D(blurA.texture, blurC, 0, texelY, smallRadius)
    }

    // ── Pass 4: clarity composite (developed + blur) → canvas, letterboxed. ──
    // Shrink the quad on the axis that would otherwise overflow.
    const canvasAspect = canvasWidth / canvasHeight
    const imageAspect = this.imageWidth / this.imageHeight
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
    gl.uniform2f(this.uClarityScale, scaleX, scaleY)
    gl.uniform1f(this.uClarityFlipV, 1) // samples FBO textures: flip to cancel their inversion
    gl.uniform1f(this.uClarity, adjustments.clarity)
    gl.uniform1f(this.uDehaze, adjustments.dehaze)
    gl.uniform1f(this.uTexture, adjustments.texture)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, developed.texture)
    gl.uniform1i(this.uClarityDeveloped, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, blurB.texture)
    gl.uniform1i(this.uClarityBlur, 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, blurC.texture)
    gl.uniform1i(this.uClarityBlurSmall, 2)
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
    gl.deleteTexture(this.texture)
    gl.deleteTexture(this.curveLut)
    gl.deleteBuffer(this.buffer)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
    gl.deleteProgram(this.clarityProgram)
    gl.deleteProgram(this.blurProgram)
  }
}
