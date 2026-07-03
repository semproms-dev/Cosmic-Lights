import { createProgram } from './glContext'
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders'

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
   * @param exposure - Exposure in stops; `rgb *= 2^exposure`.
   * @param contrast - Contrast in [-100, 100]; scales rgb around the 0.5 pivot.
   * @param highlights - Highlights in [-100, 100]; luma-masked offset on bright zones.
   * @param shadows - Shadows in [-100, 100]; luma-masked offset on dark zones.
   * @param whites - Whites in [-100, 100]; luma-masked offset on the brightest extreme.
   * @param blacks - Blacks in [-100, 100]; luma-masked offset on the darkest extreme.
   * @param temperature - Temperature in [-100, 100]; blue↔amber channel gains (multiplicative).
   * @param tint - Tint in [-100, 100]; green↔magenta green-channel gain (multiplicative).
   * @param vibrance - Vibrance in [-100, 100]; saturation weighted toward muted pixels.
   * @param saturation - Saturation in [-100, 100]; uniform luma↔color blend.
   * @param canvasWidth - Canvas backing-store width in device pixels.
   * @param canvasHeight - Canvas backing-store height in device pixels.
   */
  render(exposure: number, contrast: number, highlights: number, shadows: number, whites: number, blacks: number, temperature: number, tint: number, vibrance: number, saturation: number, canvasWidth: number, canvasHeight: number): void {
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
    gl.uniform1f(this.uExposure, exposure)
    gl.uniform1f(this.uContrast, contrast)
    gl.uniform1f(this.uHighlights, highlights)
    gl.uniform1f(this.uShadows, shadows)
    gl.uniform1f(this.uWhites, whites)
    gl.uniform1f(this.uBlacks, blacks)
    gl.uniform1f(this.uTemperature, temperature)
    gl.uniform1f(this.uTint, tint)
    gl.uniform1f(this.uVibrance, vibrance)
    gl.uniform1f(this.uSaturation, saturation)
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
