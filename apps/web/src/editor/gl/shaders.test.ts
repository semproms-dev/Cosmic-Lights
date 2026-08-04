import { describe, expect, it } from 'vitest'
import {
  GRADE_BALANCE_RANGE,
  GRADE_BLEND_MAX,
  GRADE_BLEND_MIN,
  GRADE_LUM_RANGE,
} from '../colorGrading'
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

  it('grades between saturation and the curves', () => {
    // After saturation, or a later global saturation would amplify the tint the
    // wheels just laid down; before the curves, or moving a curve point would
    // redistribute which pixels each zone owns.
    const saturation = FRAGMENT_SHADER.indexOf('rgb = mix(vec3(lumaC), rgb, 1.0 + sat);')
    const grading = FRAGMENT_SHADER.indexOf('rgb = applyGrading(')
    const curves = FRAGMENT_SHADER.indexOf('rgb.r = applyCurve(rgb.r, 1.0);')

    expect(saturation).toBeGreaterThan(-1)
    expect(grading).toBeGreaterThan(saturation)
    expect(curves).toBeGreaterThan(grading)
  })

  it('keeps colour grading out of the mask pass', () => {
    // Grading is global on purpose (§5 of the doc): in the mask pass it would be
    // eight more uniforms per mask per pixel, and eight keys a mask could save,
    // undo and export while the mask shader painted nothing with them.
    expect(MASK_FRAGMENT_SHADER).not.toContain('applyGrading(')
    expect(MASK_FRAGMENT_SHADER).not.toContain('uGradeShadow')
  })

  it('defines hsvToRgb once, in the shared chunk', () => {
    // The day the mixer or a local grading arrives, the second copy is the bug:
    // both features need this function and only one may declare it.
    const declarations = FRAGMENT_SHADER.match(/vec3 hsvToRgb\(/g) ?? []
    expect(declarations).toHaveLength(1)
  })

  it('is an exact identity while every zone is at rest', () => {
    // All six controls at 0 must return the pixel untouched — not merely close.
    // Anything else restyles every photo edited before grading existed.
    expect(FRAGMENT_SHADER).toContain('if (touched <= 0.0) { return rgb; }')
  })

  it('counts a darkened zone as touched even with no tint on it', () => {
    // The luminances join the early-out by ABSOLUTE value. Summed raw, a zone
    // darkened to -40 would cancel another brightened to +40 and the whole block
    // would be skipped; tested by saturation alone, a zone darkened with no tint
    // — an ordinary edit — would never render at all.
    expect(FRAGMENT_SHADER).toContain('+ abs(shadow.z) + abs(mid.z) + abs(high.z);')
  })

  it('brightens a zone with an offset, not a multiply', () => {
    // The tint multiplies so a tinted black stays black; the luminance has to
    // add, or "brighten the shadows" would do nothing to the darkest pixels —
    // the one place it is asked for.
    expect(FRAGMENT_SHADER).toContain('return tinted + weight * (zone.z / 100.0) * GRADE_LUM_RANGE;')
  })

  it('writes the grading constants as GLSL float literals', () => {
    // Interpolated from `colorGrading.ts` so the shader and its TypeScript twin
    // cannot drift — and as floats, because `const float x = 5;` does not
    // compile in GLSL ES 3.00.
    expect(FRAGMENT_SHADER).toContain(`const float GRADE_BLEND_MIN = ${GRADE_BLEND_MIN.toFixed(1)};`)
    expect(FRAGMENT_SHADER).toContain(`const float GRADE_BLEND_MAX = ${GRADE_BLEND_MAX.toFixed(1)};`)
    expect(FRAGMENT_SHADER).toContain(
      `const float GRADE_BALANCE_RANGE = ${GRADE_BALANCE_RANGE.toFixed(1)};`,
    )
    expect(FRAGMENT_SHADER).toContain(`const float GRADE_LUM_RANGE = ${GRADE_LUM_RANGE.toFixed(2)};`)
    expect(FRAGMENT_SHADER).toMatch(/const float GRADE_BLEND_MIN = \d+\.\d+;/)
  })

  it('clamps the luma before the zone powers', () => {
    // `pow` of a negative base is NaN, and one NaN pixel paints the whole frame
    // black with no GL error to point at it.
    expect(FRAGMENT_SHADER).toContain('float l = clamp(dot(rgb, LUMA), 0.0, 1.0);')
  })

  it('writes the amount map range as a GLSL float literal', () => {
    // Interpolated from TypeScript: a bare `5` would be an int and
    // `float RANGE = 5;` does not compile in GLSL ES 3.00.
    expect(AMOUNT_MAP_FRAGMENT_SHADER).toContain(`const float RANGE = ${AMOUNT_MAP_RANGE.toFixed(1)};`)
    expect(AMOUNT_MAP_FRAGMENT_SHADER).toMatch(/const float RANGE = \d+\.\d+/)
  })

  it('paints a backdrop where the free angle leaves the frame', () => {
    // A rotated quad's corners sample outside [0,1]²; the composite must return
    // the backdrop colour there rather than clamping the image's edge texels.
    expect(CLARITY_FRAGMENT_SHADER).toContain('uniform vec3 uBackdrop')
    expect(CLARITY_FRAGMENT_SHADER).toContain('vec4(uBackdrop, 1.0)')
    expect(CLARITY_FRAGMENT_SHADER).toContain('texture(uDeveloped, uv)')
  })

  it('keeps the frame edge inside the backdrop guard (inclusive bounds)', () => {
    // uv == 0.0 / 1.0 exactly is the edge texel of the FRAME, not the backdrop:
    // strict `<`/`>` comparisons would paint the four corners of every unrotated
    // photo with the backdrop colour.
    expect(CLARITY_FRAGMENT_SHADER).toMatch(/all\(greaterThanEqual\(uv, vec2\(0\.0\)\)\)/)
    expect(CLARITY_FRAGMENT_SHADER).toMatch(/all\(lessThanEqual\(uv, vec2\(1\.0\)\)\)/)
  })
})
