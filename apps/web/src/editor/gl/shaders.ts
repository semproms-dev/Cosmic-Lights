/**
 * GLSL sources for the editor pipeline. WebGL2 (`#version 300 es`).
 *
 * The vertex shader draws a single full-screen quad and scales it in clip space
 * so the image keeps its aspect ratio (letterboxed) inside the canvas. The
 * fragment shader is the pixel pipeline: tone (exposure/contrast/zones), colour
 * (white balance + presence), tone curves (a per-channel LUT texture) and
 * details (unsharp mask + threshold). Every point-wise adjustment plugs in as
 * another uniform and a couple of lines; the details group is the first that
 * samples neighbouring texels (see `uTexel`).
 */

/** Full-screen quad; `uScale` letterboxes the image to preserve its aspect. */
export const VERTEX_SHADER = `#version 300 es
// Pin the location so a single shared VAO works for every program that uses
// this vertex shader (the pipeline pass and the copy/composite pass).
layout(location = 0) in vec2 aPos;
uniform vec2 uScale;
// Pan translation in clip space, applied after uScale. Only the composite pass
// sets it (view zoom/pan); it defaults to (0,0) elsewhere so those passes still
// fill their target exactly.
uniform vec2 uOffset;
// 1.0 when this pass samples an FBO texture, 0.0 when it samples the uploaded
// RAW. Rendering into an FBO stores it inverted vs a texture uploaded with
// UNPACK_FLIP_Y, so a pass reading an FBO flips V to cancel that inversion.
// Doing it per-pass keeps every pass correct regardless of how many there are.
uniform float uFlipV;
out vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  vUv.y = mix(vUv.y, 1.0 - vUv.y, uFlipV);
  gl_Position = vec4(aPos * uScale + uOffset, 0.0, 1.0);
}
`

/**
 * Composite pass (final blit to the canvas): combines the developed image with
 * its large blur to apply the local-contrast effects that all need that blur —
 * clarity and dehaze (texture will join later). The letterbox lives in the
 * shared vertex shader's `uScale`. Every slider is the identity at 0.
 *
 * - Clarity: large-radius unsharp mask on luma, biased to the midtones.
 * - Texture: the same USM with a small-radius blur, so it lifts fine detail
 *   (skin, fabric) instead of mid-sized structures.
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
uniform sampler2D uBlurSmall;   // its small-radius blur (for texture)
uniform float uClarity;         // -5..5
uniform float uDehaze;          // -5..5
uniform float uTexture;         // -5..5
uniform mat2 uUvMatrix;         // crop size + 90° turns + flips, about the centre
uniform vec2 uUvCenter;         // UV of the crop centre (0.5,0.5 = no crop)
uniform sampler2D uOverlayMask; // active mask alpha, for the editing overlay
uniform float uOverlay;         // 1 → tint the masked area red so it's visible

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  // Non-destructive crop + orientation: remap the quad onto the selected region,
  // turned/mirrored about its centre. Built on the CPU by uvTransform()
  // (editor/rotation.ts); identity (mat2(1.0), centre 0.5) means uv == vUv.
  vec2 uv = uUvCenter + uUvMatrix * (vUv - 0.5);
  vec4 base = texture(uDeveloped, uv);
  vec3 rgb = base.rgb;
  float clarityAmt = uClarity * 0.2;              // slider → strength (k, tunable)
  float textureAmt = uTexture * 0.2;              // slider → strength (k, tunable)
  float d = uDehaze * 0.15;                        // slider → strength (k, tunable)

  // Local contrast in two frequency bands: clarity/dehaze on the large blur,
  // texture on the small blur. One midtone-weighted rescale folds them together.
  float L = dot(rgb, LUMA);                        // developed luma
  float B = dot(texture(uBlur, uv).rgb, LUMA);    // large-blur luma
  float Bs = dot(texture(uBlurSmall, uv).rgb, LUMA); // small-blur luma
  float D = L - B;                                 // mid-frequency microcontrast
  float Ds = L - Bs;                               // fine-frequency detail
  float w = 1.0 - pow(2.0 * L - 1.0, 2.0);         // midtone mask: 0 at black/white, 1 at mid
  float Lp = L + w * ((clarityAmt + d) * D + textureAmt * Ds);
  rgb *= Lp / max(L, 1e-4);                        // rescale RGB → preserve hue

  // Dehaze tone/colour (option B). Each term is the identity when d = 0.
  float bl = d * 0.5;                              // black-point lift (gentler than d)
  rgb = (rgb - bl) / (1.0 - bl);                   // recover haze-lifted blacks
  float Ld = dot(rgb, LUMA);
  rgb = mix(vec3(Ld), rgb, 1.0 + d);               // restore saturation lost to haze
  rgb += d * 0.05 * vec3(1.0, 0.0, -1.0);          // warm the tint against the cool haze

  vec3 outRgb = clamp(rgb, 0.0, 1.0);
  // Mask-editing overlay: tint the painted area red so the user sees the mask
  // regardless of its adjustments. Off (uOverlay = 0) during normal viewing.
  float mo = texture(uOverlayMask, uv).r * uOverlay;
  outRgb = mix(outRgb, vec3(0.95, 0.15, 0.15), mo * 0.5);
  fragColor = vec4(outRgb, base.a);
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

/**
 * Local-adjustment mask pass. Reads the current developed image (`uImage`),
 * applies this mask's own tone+colour adjustments (the same Basic+Color maths as
 * the main pipeline — no curves, no sharpen: those stay global), then blends the
 * adjusted result over the untouched input weighted by the mask's alpha
 * (`uMask`, single channel). Run once per mask, stacking on the previous result.
 *
 * The adjustment block is intentionally a copy of the tone/colour section of
 * FRAGMENT_SHADER: masks re-develop the already-developed pixels, so their
 * sliders act as a *local delta* on top of the global grade.
 */
export const MASK_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;   // current developed image (input to this mask)
uniform sampler2D uMask;    // this mask's alpha (weight in .r)
uniform float uInvert;      // 1.0 → affect the area OUTSIDE the selection
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

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec4 texel = texture(uImage, vUv);
  vec3 base = texel.rgb;
  vec3 rgb = base * exp2(uExposure);
  float k = 1.0 + uContrast / 100.0;
  float hi = uHighlights / 100.0;
  float sh = uShadows / 100.0;
  float wh = uWhites / 100.0;
  float bl = uBlacks / 100.0;
  float t = uTemperature / 100.0;
  float ti = uTint / 100.0;
  float vib = uVibrance / 100.0;
  float sat = uSaturation / 100.0;
  float luma = clamp(dot(rgb, LUMA), 0.0, 1.0);
  float dark = 1.0 - luma;
  rgb += hi * 0.25 * (luma * luma);
  rgb += sh * 0.25 * (dark * dark);
  rgb += wh * 0.25 * (luma * luma * luma * luma);
  rgb += bl * 0.25 * (dark * dark * dark * dark);
  rgb = (rgb - 0.5) * k + 0.5;
  rgb.r *= 1.0 + t * 0.3;
  rgb.b *= 1.0 - t * 0.3;
  rgb.g *= 1.0 - ti * 0.3;
  float lumaC = dot(rgb, LUMA);
  float curSat = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
  rgb = mix(vec3(lumaC), rgb, 1.0 + vib * (1.0 - curSat));
  rgb = mix(vec3(lumaC), rgb, 1.0 + sat);
  rgb = clamp(rgb, 0.0, 1.0);

  // Mask weight, optionally inverted, gates the whole local adjustment.
  float w = clamp(texture(uMask, vUv).r, 0.0, 1.0);
  w = mix(w, 1.0 - w, uInvert);
  fragColor = vec4(mix(base, rgb, w), texel.a);
}
`

/**
 * Brush stamp — vertex stage. Positions a unit quad as a disc of clip-space
 * half-size `uRadius` centred at `uCenter`, and passes the local -1..1 coords to
 * the fragment stage so it can shade a soft circle. Drawn repeatedly along a
 * stroke into the mask's alpha target.
 */
export const BRUSH_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec2 uCenter;   // stamp centre in clip space (-1..1)
uniform vec2 uRadius;   // stamp half-size in clip space (rx, ry)
out vec2 vLocal;        // -1..1 within the stamp
void main() {
  vLocal = aPos;
  gl_Position = vec4(aPos * uRadius + uCenter, 0.0, 1.0);
}
`

/**
 * Brush stamp — fragment stage. Shades a soft disc: full coverage inside
 * `uHardness`, ramping to 0 at the edge. The caller sets the blend state so
 * stamps either union into the mask (paint) or cut out of it (erase); the
 * shader only emits per-fragment coverage in every channel.
 */
export const BRUSH_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vLocal;
out vec4 fragColor;
uniform float uHardness;  // 0 (soft) .. 1 (hard)
void main() {
  float d = length(vLocal);          // 0 at centre → 1 at edge
  if (d > 1.0) { discard; }
  float a = 1.0 - smoothstep(uHardness, 1.0, d);
  fragColor = vec4(a, a, a, a);
}
`

/** Pixel pipeline: exposure → highlights → shadows → whites → blacks → contrast → temp/tint → vibrance → saturation → curves → sharpness/threshold. */
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;


uniform sampler2D uImage;
// Tone-curve LUT: a 256×4 texture (one row per channel, master rgb + red/green/
// blue). The R8 texel at (input, channel) is that channel's output value.
uniform sampler2D uCurveLut;
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

/**
 * Maps one channel value through its tone-curve LUT row.
 *
 * The value is clamped to 0..1 and remapped to the texel centres of the 256-wide
 * LUT (so input 0 hits entry 0 and input 1 hits entry 255); LINEAR filtering then
 * interpolates smoothly between entries. row selects the channel (0 = master
 * rgb, 1/2/3 = red/green/blue); +0.5/4 lands on the row centre so no vertical
 * interpolation bleeds between channels. Identity curves make this a no-op.
 */
float applyCurve(float v, float row) {
  float u = clamp(v, 0.0, 1.0) * (255.0 / 256.0) + (0.5 / 256.0);
  return texture(uCurveLut, vec2(u, (row + 0.5) / 4.0)).r;
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
  // Tone curves. Per-channel red/green/blue first, then the master rgb curve on
  // every channel (Photoshop's order). Identity LUTs leave rgb untouched.
  rgb.r = applyCurve(rgb.r, 1.0);
  rgb.g = applyCurve(rgb.g, 2.0);
  rgb.b = applyCurve(rgb.b, 3.0);
  rgb.r = applyCurve(rgb.r, 0.0);
  rgb.g = applyCurve(rgb.g, 0.0);
  rgb.b = applyCurve(rgb.b, 0.0);
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
