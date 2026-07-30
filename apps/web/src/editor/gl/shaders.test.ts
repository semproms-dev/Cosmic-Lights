import { describe, expect, it } from 'vitest'
import {
  AMOUNT_MAP_FRAGMENT_SHADER,
  AMOUNT_MAP_RANGE,
  BLUR_FRAGMENT_SHADER,
  CLARITY_FRAGMENT_SHADER,
  DENOISE_FRAGMENT_SHADER,
  FRAGMENT_SHADER,
  MASK_FRAGMENT_SHADER,
  VERTEX_SHADER,
} from './shaders'

/**
 * Every shader source, so the structural checks below cannot miss one that is
 * added later.
 */
const ALL_SHADERS: [string, string][] = [
  ['VERTEX_SHADER', VERTEX_SHADER],
  ['FRAGMENT_SHADER', FRAGMENT_SHADER],
  ['MASK_FRAGMENT_SHADER', MASK_FRAGMENT_SHADER],
  ['CLARITY_FRAGMENT_SHADER', CLARITY_FRAGMENT_SHADER],
  ['BLUR_FRAGMENT_SHADER', BLUR_FRAGMENT_SHADER],
  ['DENOISE_FRAGMENT_SHADER', DENOISE_FRAGMENT_SHADER],
  ['AMOUNT_MAP_FRAGMENT_SHADER', AMOUNT_MAP_FRAGMENT_SHADER],
]

/**
 * These tests exist because GLSL is the one part of the pipeline the suite
 * cannot execute — jsdom has no GPU, so a broken shader only shows up as a black
 * frame in the browser. They cannot check that a shader *compiles*; what they can
 * check is the structure that template interpolation makes easy to break.
 */
describe('shader sources', () => {
  it.each(ALL_SHADERS)('%s declares its version on the very first line', (_name, source) => {
    // `#version` must be the first thing in the source. Interpolating a shared
    // chunk above it is an easy slip and fails at compile time with a message
    // that points nowhere useful.
    expect(source.trimStart().startsWith('#version 300 es')).toBe(true)
  })

  it('shares one exposure implementation between the two develop passes', () => {
    // The mask pass is a deliberate copy of the pipeline pass's tone block, so
    // the risk is a fix landing in one and not the other — a mask that exposes
    // differently from the global slider. Both must call the shared helper, and
    // neither may keep the old gamma-space multiply.
    for (const source of [FRAGMENT_SHADER, MASK_FRAGMENT_SHADER]) {
      expect(source).toContain('applyExposure(')
      expect(source).toContain('float shoulderCurve(float x)')
      expect(source).not.toContain('exp2(uExposure)')
    }
  })

  it('applies exposure in linear light, not on the encoded values', () => {
    // The whole point of the change: undo gamma, scale, put it back. Losing the
    // round trip would silently restore the old behaviour, where "+1 stop" meant
    // ~2.2 and the frame went white a fifth of the way up the slider.
    expect(FRAGMENT_SHADER).toContain('EXPOSURE_GAMMA')
    expect(FRAGMENT_SHADER).toContain('pow(max(c, 0.0), vec3(EXPOSURE_GAMMA))')
    expect(FRAGMENT_SHADER).toContain('1.0 / EXPOSURE_GAMMA')
  })

  it('keeps exposure an exact identity at rest', () => {
    // Without this early out the shoulder would dim already-blown highlights on
    // every photo, including ones edited before it existed.
    expect(FRAGMENT_SHADER).toContain('if (ev == 0.0) { return c; }')
  })

  it('writes the amount map range as a GLSL float literal', () => {
    // Interpolated from TypeScript: a bare `5` would be an int and
    // `float RANGE = 5;` does not compile in GLSL ES 3.00.
    expect(AMOUNT_MAP_FRAGMENT_SHADER).toContain(`const float RANGE = ${AMOUNT_MAP_RANGE.toFixed(1)};`)
    expect(AMOUNT_MAP_FRAGMENT_SHADER).toMatch(/const float RANGE = \d+\.\d+;/)
  })
})
