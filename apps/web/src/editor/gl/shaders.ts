/**
 * GLSL sources for the editor pipeline. WebGL2 (`#version 300 es`).
 *
 * The vertex shader draws a single full-screen quad and scales it in clip space
 * so the image keeps its aspect ratio (letterboxed) inside the canvas. The
 * fragment shader is the pixel pipeline: tone (exposure/contrast/zones), colour
 * (white balance + presence) and details (unsharp mask + threshold). Every
 * point-wise adjustment plugs in as another uniform and a couple of lines; the
 * details group is the first that samples neighbouring texels (see `uTexel`).
 */

/** Full-screen quad; `uScale` letterboxes the image to preserve its aspect. */
export const VERTEX_SHADER = `#version 300 es
// Pin the location so a single shared VAO works for every program that uses
// this vertex shader (the pipeline pass and the copy/composite pass).
layout(location = 0) in vec2 aPos;
uniform vec2 uScale;
// 1.0 when this pass samples an FBO texture, 0.0 when it samples the uploaded
// RAW. Rendering into an FBO stores it inverted vs a texture uploaded with
// UNPACK_FLIP_Y, so a pass reading an FBO flips V to cancel that inversion.
// Doing it per-pass keeps every pass correct regardless of how many there are.
uniform float uFlipV;
out vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  vUv.y = mix(vUv.y, 1.0 - vUv.y, uFlipV);
  gl_Position = vec4(aPos * uScale, 0.0, 1.0);
}
`

/**
 * Composite pass (final blit to the canvas): combines the developed image with
 * its large blur to apply the local-contrast effects that all need that blur —
 * clarity and dehaze (texture will join later). The letterbox lives in the
 * shared vertex shader's `uScale`. Every slider is the identity at 0.
 *
 * - Clarity: large-radius unsharp mask on luma, biased to the midtones.
 * - Dehaze (option B, pragmatic): haze = lifted blacks + flat contrast + low
 *   saturation + cool tint, so removing it lowers the black point, adds local
 *   contrast, restores saturation and warms the tint (all scaled by `d`, and
 *   reversed for negative dehaze = adding haze).
 */
export const CLARITY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uDeveloped;   // the sharp, graded image
uniform sampler2D uBlur;        // its large-radius blur
uniform float uClarity;         // -5..5
uniform float uDehaze;          // -5..5

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec4 base = texture(uDeveloped, vUv);
  vec3 rgb = base.rgb;
  float clarityAmt = uClarity * 0.2;              // slider → strength (k, tunable)
  float d = uDehaze * 0.15;                        // slider → strength (k, tunable)

  // Shared large-radius local contrast (clarity + dehaze both use the blur).
  float L = dot(rgb, LUMA);                        // developed luma
  float B = dot(texture(uBlur, vUv).rgb, LUMA);    // blurred luma
  float D = L - B;                                 // local microcontrast
  float w = 1.0 - pow(2.0 * L - 1.0, 2.0);         // midtone mask: 0 at black/white, 1 at mid
  float Lp = L + (clarityAmt + d) * w * D;         // dehaze adds its own local contrast
  rgb *= Lp / max(L, 1e-4);                        // rescale RGB → preserve hue

  // Dehaze tone/colour (option B). Each term is the identity when d = 0.
  float bl = d * 0.5;                              // black-point lift (gentler than d)
  rgb = (rgb - bl) / (1.0 - bl);                   // recover haze-lifted blacks
  float Ld = dot(rgb, LUMA);
  rgb = mix(vec3(Ld), rgb, 1.0 + d);               // restore saturation lost to haze
  rgb += d * 0.05 * vec3(1.0, 0.0, -1.0);          // warm the tint against the cool haze

  fragColor = vec4(clamp(rgb, 0.0, 1.0), base.a);
}
`

/**
 * One 1D pass of a separable Gaussian blur. Run it twice (horizontal then
 * vertical, via `uDirection`) to get a full 2D blur at cost 2·r instead of r².
 * `uDirection` is the per-texel step along the blur axis: (1/w, 0) horizontal,
 * (0, 1/h) vertical. `uRadius` is the truncation radius in texels (≈ 3·sigma).
 * This is the large-radius blur clarity/dehaze/texture are built on.
 */
export const BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2 uDirection;
uniform float uRadius;

// Hard cap on taps per side (compile-time loop bound); samples beyond uRadius
// are skipped, so the effective radius is driven by the uniform.
const int MAX_RADIUS = 48;

void main() {
  // sigma = radius/3 so the Gaussian has decayed to ~1% at the truncation edge.
  float sigma = max(uRadius / 3.0, 1e-4);
  float twoSigma2 = 2.0 * sigma * sigma;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -MAX_RADIUS; i <= MAX_RADIUS; i++) {
    if (float(abs(i)) > uRadius) { continue; }
    float w = exp(-float(i * i) / twoSigma2);
    sum += texture(uSource, vUv + uDirection * float(i)).rgb * w;
    wsum += w;
  }
  fragColor = vec4(sum / wsum, 1.0);
}
`

/** Pixel pipeline: exposure → highlights → shadows → whites → blacks → contrast → temp/tint → vibrance → saturation → sharpness/threshold. */
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;


uniform sampler2D uImage;
uniform float uExposure;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uTemperature;
uniform float uTint;
uniform float uVibrance;
uniform float uSaturation;
// Details group: size of one texel in UV space (1/width, 1/height) so the
// unsharp mask can reach its 8 neighbours, plus the two Details sliders.
uniform vec2 uTexel;
uniform float uSharpness;
uniform float uThreshold;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

/** Rec.709 luma of the raw texture at a given UV (used by the 3x3 sharpen). */
float sampleLuma(vec2 uv) {
  return dot(texture(uImage, uv).rgb, LUMA);
}

void main() {
  vec4 texel = texture(uImage, vUv);
  vec3 rgb = texel.rgb * exp2(uExposure);
  float k = 1.0 + uContrast / 100.0;
  float hi = uHighlights / 100.0;
  float sh = uShadows / 100.0;
  float wh = uWhites / 100.0;
  float bl = uBlacks / 100.0;
  float t = uTemperature / 100.0;
  float ti = uTint / 100.0;
  float vib = uVibrance / 100.0;
  float sat = uSaturation / 100.0;
  // Clamp luma before raising to a power so an over-exposed pixel (luma > 1)
  // can't push the tone offsets super-linearly past their intended strength.
  float luma = clamp(dot(rgb, LUMA), 0.0, 1.0);
  float dark = 1.0 - luma;
  // Zone masks: highlights/shadows use ^2 (broad ranges), whites/blacks use ^4
  // (concentrated on the extremes) so the four sliders act on distinct tones.
  rgb += hi * 0.25 * (luma * luma);
  rgb += sh * 0.25 * (dark * dark);
  rgb += wh * 0.25 * (luma * luma * luma * luma);
  rgb += bl * 0.25 * (dark * dark * dark * dark);
  rgb = (rgb - 0.5) * k + 0.5;
  rgb.r *= 1.0 + t * 0.3;
  rgb.b *= 1.0 - t * 0.3;
  rgb.g *= 1.0 - ti * 0.3;
  // Presence: recompute luma on the CURRENT rgb (post tone + WB), NOT the frozen
  // zone luma above, and unclamped so mix() preserves luma exactly. One lumaC
  // serves both blends.
  float lumaC = dot(rgb, LUMA);
  // Vibrance boosts muted pixels more (weighted by 1 - current saturation);
  // saturation scales every pixel uniformly.
  float curSat = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
  rgb = mix(vec3(lumaC), rgb, 1.0 + vib * (1.0 - curSat));
  rgb = mix(vec3(lumaC), rgb, 1.0 + sat);
  // Details (unsharp mask). SINGLE-PASS caveat: the 3x3 blur samples the RAW
  // texture, not the tone/colour result above, so the sharpen sees pre-graded
  // luma. Acceptable for a small fixed radius; the multi-pass FBO path will fix
  // it later. Sharpen on LUMA and add the same delta to RGB to avoid colour
  // fringes. amount = uSharpness (-5..5); negative amounts soften.
  float blurLuma = (
    sampleLuma(vUv + uTexel * vec2(-1.0, -1.0)) +
    sampleLuma(vUv + uTexel * vec2( 0.0, -1.0)) +
    sampleLuma(vUv + uTexel * vec2( 1.0, -1.0)) +
    sampleLuma(vUv + uTexel * vec2(-1.0,  0.0)) +
    sampleLuma(vUv                            ) +
    sampleLuma(vUv + uTexel * vec2( 1.0,  0.0)) +
    sampleLuma(vUv + uTexel * vec2(-1.0,  1.0)) +
    sampleLuma(vUv + uTexel * vec2( 0.0,  1.0)) +
    sampleLuma(vUv + uTexel * vec2( 1.0,  1.0))
  ) / 9.0;
  float detail = sampleLuma(vUv) - blurLuma;
  // Threshold = dead-band against noise: 0..100 maps to a 0..0.1 luma band;
  // details weaker than the band are ignored. smoothstep instead of a hard if
  // to avoid a visible edge in the effect itself. Negatives clamp to 0 (sharpen
  // everything). At 0, only the softest micro-detail (< the ramp) is spared.
  float thr = max(uThreshold, 0.0) / 1000.0;
  float mask = smoothstep(thr, thr + 0.02, abs(detail));
  rgb += uSharpness * detail * mask;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), texel.a);
}
`
