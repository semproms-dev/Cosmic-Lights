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
