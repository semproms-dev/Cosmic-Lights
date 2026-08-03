/**
 * Low-level WebGL helpers: compile a shader and link a program. Kept separate
 * from the renderer so the GL boilerplate stays out of the pipeline logic.
 */

/**
 * Compiles one shader stage. Throws with the driver's info log on failure so
 * the caller can surface a useful message.
 *
 * @param gl - The WebGL2 context.
 * @param type - `gl.VERTEX_SHADER` or `gl.FRAGMENT_SHADER`.
 * @param source - GLSL source for the stage.
 * @returns The compiled shader.
 */
function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (shader === null) {
    throw new Error('Failed to create shader')
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed: ${log ?? 'unknown error'}`)
  }
  return shader
}

/**
 * An off-screen render target: a texture plus the framebuffer that draws into
 * it. Binding `framebuffer` redirects rendering away from the canvas and into
 * `texture`, which a later pass can then sample. This is the building block of
 * the multi-pass pipeline (render the developed image → blur it → composite).
 */
export interface RenderTarget {
  /** Bind this to draw into the target instead of the canvas. */
  framebuffer: WebGLFramebuffer
  /** The texture the framebuffer draws into; sample this in a later pass. */
  texture: WebGLTexture
  /** Target width in pixels. */
  width: number
  /** Target height in pixels. */
  height: number
}

/**
 * Whether this context can render into 16-bit float targets.
 *
 * WebGL2 always *accepts* an RGBA16F texture, but attaching one to a framebuffer
 * is only legal with this extension — so asking has to happen before the target
 * is built, not after it fails. Enabling the extension is idempotent, and
 * filtering half-float textures is core in ES 3.0, so nothing else is needed.
 *
 * @param gl - The WebGL2 context.
 * @returns True when {@link createRenderTarget} can honour `halfFloat`.
 */
export function supportsHalfFloatTargets(gl: WebGL2RenderingContext): boolean {
  return (
    gl.getExtension('EXT_color_buffer_half_float') !== null ||
    gl.getExtension('EXT_color_buffer_float') !== null
  )
}

/**
 * Storage a render target can use.
 *
 * `rgba8` stores pictures, which is what most of the pipeline moves around. The
 * half-float formats are for targets whose contents are *not* pictures:
 *
 * - **differences**, where a chain that subtracts two 8-bit values and adds the
 *   result to a third quantises three times over and bands a smooth sky;
 * - **running totals**, which leave the 0..1 range an 8-bit target clamps to.
 *
 * The narrow ones exist because these targets are full-resolution and a 24 MP
 * frame does not have three spare RGBA16F buffers to give: `r16f` is a quarter
 * the memory of `rgba16f` and holds exactly as much as a distance needs.
 */
export type RenderTargetFormat = 'rgba8' | 'rgba16f' | 'rg16f' | 'r16f'

/** Knobs for {@link createRenderTarget}; every one of them is optional. */
export interface RenderTargetOptions {
  /**
   * Storage for the target; defaults to `rgba8`.
   *
   * A half-float request degrades to `rgba8` when
   * {@link supportsHalfFloatTargets} says no, so a caller that *needs* the range
   * or the precision has to check for itself rather than assume it got it.
   */
  format?: RenderTargetFormat
}

/** The GL triplet each format allocates with. */
const FORMAT_SPECS: Record<
  Exclude<RenderTargetFormat, 'rgba8'>,
  (gl: WebGL2RenderingContext) => [internalFormat: number, format: number]
> = {
  rgba16f: (gl) => [gl.RGBA16F, gl.RGBA],
  rg16f: (gl) => [gl.RG16F, gl.RG],
  r16f: (gl) => [gl.R16F, gl.RED],
}

/**
 * Creates an off-screen render target sized `width`×`height` (RGBA8 by default,
 * LINEAR filtering, clamped edges) with an empty texture attached to a
 * framebuffer. The caller owns it and must call {@link deleteRenderTarget} when
 * done or when the size changes.
 *
 * @param gl - The WebGL2 context.
 * @param width - Target width in pixels.
 * @param height - Target height in pixels.
 * @param options - See {@link RenderTargetOptions}.
 * @returns The render target (framebuffer + texture).
 */
export function createRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  options: RenderTargetOptions = {},
): RenderTarget {
  const texture = gl.createTexture()
  const framebuffer = gl.createFramebuffer()
  if (texture === null || framebuffer === null) {
    throw new Error('Failed to create render target')
  }
  const requested = options.format ?? 'rgba8'
  const halfFloat = requested !== 'rgba8' && supportsHalfFloatTargets(gl)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // No pixels yet (last arg null): we only allocate storage; passes fill it.
  if (halfFloat) {
    const [internalFormat, format] = FORMAT_SPECS[requested as Exclude<RenderTargetFormat, 'rgba8'>](gl)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.HALF_FLOAT, null)
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  // A driver may advertise the extension and still refuse this exact attachment.
  // Re-allocating as RGBA8 costs one texture upload on a path that will never run
  // on most machines, and beats handing back a target that silently draws
  // nothing.
  if (halfFloat && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  }
  // Leave the canvas as the active draw target when we return.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return { framebuffer, texture, width, height }
}

/**
 * Frees the GPU resources of a render target created by {@link createRenderTarget}.
 *
 * @param gl - The WebGL2 context.
 * @param target - The render target to delete.
 */
export function deleteRenderTarget(gl: WebGL2RenderingContext, target: RenderTarget): void {
  gl.deleteFramebuffer(target.framebuffer)
  gl.deleteTexture(target.texture)
}

/**
 * Compiles and links a vertex/fragment pair into a program. The individual
 * shaders are deleted after linking (the program keeps its own copies).
 *
 * @param gl - The WebGL2 context.
 * @param vertexSource - GLSL source for the vertex stage.
 * @param fragmentSource - GLSL source for the fragment stage.
 * @returns The linked program.
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const program = gl.createProgram()
  if (program === null) {
    throw new Error('Failed to create program')
  }
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program link failed: ${log ?? 'unknown error'}`)
  }
  return program
}
