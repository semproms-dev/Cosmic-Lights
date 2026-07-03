import { createProgram } from './glContext'
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders'

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
}

/**
 * Owns the WebGL2 resources for the editor pipeline: the program, the geometry
 * (a single full-screen quad) and the image texture. The React layer feeds it
 * the decoded image and the current adjustment values and asks it to draw.
 *
 * The renderer never reads from the store directly; it is a thin, imperative
 * wrapper so the pipeline can later grow (more uniforms, a curves LUT, extra
 * passes) without touching the component that hosts it.
 */
export class WebGLRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly buffer: WebGLBuffer
  private readonly texture: WebGLTexture
  private readonly uScale: WebGLUniformLocation | null
  private readonly uImage: WebGLUniformLocation | null
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

    this.uScale = gl.getUniformLocation(this.program, 'uScale')
    this.uImage = gl.getUniformLocation(this.program, 'uImage')
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
    // An ImageBitmap already arrives with its top row first, matching the UV
    // mapping in the vertex shader, so we must NOT flip on upload.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
    this.imageWidth = bitmap.width
    this.imageHeight = bitmap.height
    this.hasImage = true
  }

  /**
   * Draws the current image with the given adjustments into the canvas at the
   * given backing-store size. Fits the image to the canvas, preserving aspect.
   *
   * @param adjustments - The defaulted per-frame adjustment values.
   * @param canvasWidth - Canvas backing-store width in device pixels.
   * @param canvasHeight - Canvas backing-store height in device pixels.
   */
  render(adjustments: RenderAdjustments, canvasWidth: number, canvasHeight: number): void {
    const gl = this.gl
    gl.viewport(0, 0, canvasWidth, canvasHeight)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!this.hasImage || canvasWidth === 0 || canvasHeight === 0) {
      return
    }

    // Letterbox: shrink the quad on the axis that would otherwise overflow.
    const canvasAspect = canvasWidth / canvasHeight
    const imageAspect = this.imageWidth / this.imageHeight
    let scaleX = 1
    let scaleY = 1
    if (imageAspect > canvasAspect) {
      scaleY = canvasAspect / imageAspect
    } else {
      scaleX = imageAspect / canvasAspect
    }

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.uniform2f(this.uScale, scaleX, scaleY)
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
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  /** Releases every GL resource. Call when the host canvas unmounts. */
  dispose(): void {
    const gl = this.gl
    gl.deleteTexture(this.texture)
    gl.deleteBuffer(this.buffer)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.program)
  }
}
