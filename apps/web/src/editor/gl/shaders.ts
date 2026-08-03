import {
  GRADE_BALANCE_RANGE,
  GRADE_BLEND_MAX,
  GRADE_BLEND_MIN,
  GRADE_LUM_RANGE,
} from '../colorGrading'
import { NOISE_LUMA_BINS } from '../noiseEstimate'
import { NLM_PATCH_PIXELS, NLM_PATCH_RADIUS } from '../nlm'

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

/**
 * Exposure, shared verbatim by the two shaders that develop pixels: the pipeline
 * pass and the per-mask pass. Interpolated into both rather than copied, because
 * their tone blocks are already twin copies and a fix that lands in only one of
 * them means a mask that exposes differently from the global slider.
 *
 * **Why this is not a multiply.** `decodeRaw` takes libraw's 8-bit output, which
 * already carries its display gamma (≈2.2). Scaling those numbers directly — what
 * `rgb * exp2(ev)` used to do — is wrong twice over:
 *
 * 1. It over-delivers by the gamma. Doubling a gamma-encoded value multiplies the
 *    LIGHT by 2^2.2 ≈ 4.6, so "+1 stop" on the slider was really ~2.2 stops and
 *    the ±5 range spanned ±11 stops of exposure. Nobody needs 11.
 * 2. It clips almost immediately. A midtone at 0.5 hit pure white at +1.0 on the
 *    slider and a highlight at 0.8 at +0.32, which left barely a fifth of the
 *    travel usable before the frame went white.
 *
 * So: undo the gamma, scale in linear light, roll the highlights off, put the
 * gamma back. There is still no headroom to *recover* — the file arrives already
 * clipped at 8 bits — but the slider now means what it says and degrades softly.
 */
const EXPOSURE_GLSL = `
// libraw's default output curve is Rec.709-ish rather than exactly sRGB, so 2.2
// is an approximation either way; the residual error is far below the 2.2x the
// old gamma-space multiply was off by.
const float EXPOSURE_GAMMA = 2.2;
// Where the highlight rolloff starts, in LINEAR light. Below this, exposure is a
// plain multiply and nothing is touched. 0.9 per the table in
// docs/exposure-response.technical.md: high enough that an already-blown white
// only settles to 249/255, low enough to leave real compression room.
const float EXPOSURE_KNEE = 0.9;
// How fast the shoulder fades in with the lift (full strength at 1/this stops).
const float EXPOSURE_ROLL_IN = 2.0;

/**
 * Soft shoulder: identity up to the knee, then an asymptote at 1.0, so bright
 * areas keep their gradients instead of flattening into one white blob.
 *
 * The hyperbola is chosen for being **C¹ at the knee** — it passes through
 * exactly (k, k) with a slope of exactly 1 — so no seam shows where compression
 * starts. That seam is what betrays a naive soft clip, and it shows up as a band
 * across a sky's gradient. Reinhard's x/(1+x) is the tempting alternative and is
 * wrong here: it is the identity nowhere, so it would restyle every photo.
 */
float shoulderCurve(float x) {
  if (x <= EXPOSURE_KNEE) { return x; }
  float head = 1.0 - EXPOSURE_KNEE;
  return 1.0 - head * head / (x + 1.0 - 2.0 * EXPOSURE_KNEE);
}

/** Exposure in stops, applied in linear light with a highlight rolloff. */
vec3 applyExposure(vec3 c, float ev) {
  // Exact identity at rest — and the early out also skips two pow() per pixel on
  // every frame where the slider has not been touched.
  if (ev == 0.0) { return c; }
  vec3 lin = pow(max(c, 0.0), vec3(EXPOSURE_GAMMA)) * exp2(ev);
  float peak = max(lin.r, max(lin.g, lin.b));
  if (peak > EXPOSURE_KNEE) {
    // Scale all three channels by the SAME factor. Compressing them
    // independently is what sends a blown sky cyan: the channels reach the
    // shoulder at different points and the hue drifts as they do.
    //
    // Faded in with the lift over the first half stop, which is where this
    // diverges from the doc: there the shoulder is always on, and the price is
    // that a blown white drops to 249/255 even with exposure at 0. Ramping it
    // instead keeps rest EXACTLY untouched — no restyling of saved edits, the
    // same rule the noise defaults follow — and the ramp is short enough that
    // full protection is in place well before anything is near clipping.
    float rolled = mix(peak, shoulderCurve(peak), clamp(ev * EXPOSURE_ROLL_IN, 0.0, 1.0));
    lin *= rolled / peak;
  }
  return pow(max(lin, 0.0), vec3(1.0 / EXPOSURE_GAMMA));
}
`

/**
 * Colour grading: a tint per tonal zone, the three wheels of the Color panel.
 *
 * Only in the pipeline pass, not in the mask one. Grading is global for now (so
 * is Lightroom's), and putting it in `MASK_FRAGMENT_SHADER` would mean eight more
 * uniforms evaluated once per mask per pixel, plus eight more keys in
 * `MASK_ADJUSTMENT_KEYS`. If it ever goes local it goes as this same shared
 * chunk, interpolated into both — never copied.
 *
 * **Why a multiply and not an add.** `rgb * tint * 2` keeps black black: a
 * multiply cannot lift a zero, so tinting the shadows colours what little light
 * is there instead of fogging the frame. The ×2 is what recentres it — a
 * zero-saturation tint is white (1,1,1), so without it every pixel would halve.
 *
 * The blending and balance constants come from `colorGrading.ts`, interpolated
 * rather than retyped: the TypeScript twin of these weights is what the tests
 * exercise, and a number that drifted between the two would be invisible here.
 */
const GRADING_GLSL = `
const float GRADE_BLEND_MIN = ${GRADE_BLEND_MIN.toFixed(1)};
const float GRADE_BLEND_MAX = ${GRADE_BLEND_MAX.toFixed(1)};
const float GRADE_BALANCE_RANGE = ${GRADE_BALANCE_RANGE.toFixed(1)};
const float GRADE_LUM_RANGE = ${GRADE_LUM_RANGE.toFixed(2)};

/** Branchless HSV→RGB. h, s and v are all 0..1. */
vec3 hsvToRgb(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}

/**
 * Tints and brightens one zone. \`zone\` is what the panel stores: x = hue in
 * degrees, y = saturation 0..100, z = luminance -100..100. Both halves scale with
 * the zone's weight, so a zone at rest is an exact identity.
 *
 * The tint multiplies and the luminance ADDS, and the difference is deliberate:
 * a multiply cannot lift a zero, which is what keeps a tinted black black — but
 * it is also what would make a "brighten the shadows" slider do nothing to the
 * darkest pixels, which is the one place it is asked for. The offset is scaled
 * like the Basic zone sliders above (±0.25 at full travel).
 */
vec3 tintZone(vec3 rgb, vec3 zone, float weight) {
  float sat = zone.y / 100.0;
  vec3 tint = hsvToRgb(zone.x / 360.0, sat, 1.0);
  vec3 tinted = mix(rgb, rgb * tint * 2.0, weight * sat);
  return tinted + weight * (zone.z / 100.0) * GRADE_LUM_RANGE;
}

/** Splits the pixel between the three zones, then tints and brightens each one. */
vec3 applyGrading(vec3 rgb, vec3 shadow, vec3 mid, vec3 high, float blending, float balance) {
  // Exact identity — and an early out that skips a pow-heavy block on every
  // frame where no zone has been touched, which is most of them. The luminances
  // count too, and by absolute value: a zone darkened with no tint is a perfectly
  // ordinary edit, and testing only the saturations would silently drop it.
  float touched = shadow.y + mid.y + high.y
    + abs(shadow.z) + abs(mid.z) + abs(high.z);
  if (touched <= 0.0) { return rgb; }

  // Clamped before the pow: after exposure a luma can exceed 1, and pow() of a
  // negative base is NaN — which paints the whole frame black with no GL error.
  float l = clamp(dot(rgb, LUMA), 0.0, 1.0);
  // Balance as a gamma remap rather than an offset: nothing clips, and 0 and 1
  // stay where they are.
  float t = pow(l, exp2(-balance / 100.0 * GRADE_BALANCE_RANGE));
  float k = mix(GRADE_BLEND_MIN, GRADE_BLEND_MAX, blending / 100.0);
  float wS = pow(1.0 - t, k);
  float wH = pow(t, k);
  // By subtraction, so the three weights always sum to <= 1 with no normalising;
  // the max() is what stops a low blending from making it negative, which would
  // invert the midtone tint instead of dropping it.
  float wM = max(1.0 - wS - wH, 0.0);

  // Cascaded, but over ONE frozen set of weights taken from the incoming luma.
  // Recomputing them per zone would let the shadow tint shift which pixels the
  // midtone wheel considers midtones.
  vec3 graded = tintZone(rgb, shadow, wS);
  graded = tintZone(graded, mid, wM);
  graded = tintZone(graded, high, wH);
  return graded;
}
`

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
 * - Vignette: post-crop shading of the frame's edges. It rides here (and not in
 *   FRAGMENT_SHADER) because this is the only pass that knows `vUv`, the
 *   displayed frame — which is what makes it post-crop at no cost.
 * - Grain: film grain, for the same reason and one more (see the block below):
 *   its cell size is a fraction of the FRAME, so `vUv` is the coordinate it
 *   needs.
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
uniform float uOverlayInvert;   // 1 → invert the overlay alpha (mask affects outside)
uniform float uVignette;        // -100..100; negative darkens (Lightroom's sign)
uniform float uVignetteMid;     // 0..100; where the falloff starts
uniform float uVignetteFeather; // 0..100; how soft the transition is
uniform float uFrameAspect;     // width/height of the DISPLAYED frame
uniform sampler2D uAmountMap;   // per-pixel texture amount (see AMOUNT_MAP_FRAGMENT_SHADER)
uniform float uUseAmountMap;    // 1 → read texture's amount per pixel instead of uTexture
uniform float uAmountRange;     // the amount map's full scale, so decoding matches encoding
uniform float uGrain;           // 0..100; film-grain amount (0 = off)
uniform float uGrainSize;       // 0..100; grain cell size (0 = fine, 100 = chunky)
uniform float uGrainRoughness;  // 0..100; how clumped/irregular the grain is

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

/**
 * Deterministic hash of a lattice point → 0..1 (Hoskins' hash12). Deterministic
 * is the point: the grain must be *frozen* to the frame, or it would crawl on
 * every re-render and the export would not match what was on screen.
 */
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

/**
 * Value noise: a hash per lattice cell, smoothly interpolated. Smooth (not raw
 * white noise) so that shrinking the frame — the fit-to-window preview, a preset
 * thumbnail — averages the grain down instead of aliasing it into a crawling
 * checkerboard.
 */
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);   // smoothstep ease, so cells meet with no seam
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  // Non-destructive crop + orientation: remap the quad onto the selected region,
  // turned/mirrored about its centre. Built on the CPU by uvTransform()
  // (editor/rotation.ts); identity (mat2(1.0), centre 0.5) means uv == vUv.
  vec2 uv = uUvCenter + uUvMatrix * (vUv - 0.5);
  vec4 base = texture(uDeveloped, uv);
  vec3 rgb = base.rgb;
  float clarityAmt = uClarity * 0.2;              // slider → strength (k, tunable)
  // Texture's amount is per-pixel whenever a mask carries one: the map holds the
  // global slider plus each mask's own, split by sign across .r/.g (see
  // AMOUNT_MAP_FRAGMENT_SHADER). With no such mask the map is not even built and
  // this falls back to the plain uniform, so the common path is unchanged.
  float textureSlider = uUseAmountMap > 0.5
    ? (texture(uAmountMap, uv).r - texture(uAmountMap, uv).g) * uAmountRange
    : uTexture;
  float textureAmt = textureSlider * 0.2;         // slider → strength (k, tunable)
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

  // Post-crop vignette. Computed on vUv (the displayed frame), never on uv (the
  // uncropped image), so the oval recentres on the crop and turns with the 90°
  // rotations for free. Applied after clarity/dehaze — it shades already graded
  // light — and on the clamped colour, so the "screen" branch can't invert.
  vec2 vAxis = vec2(max(uFrameAspect, 1.0), max(1.0 / uFrameAspect, 1.0));
  // Aspect-corrected distance to the centre: 0 at the centre, 1 at the corner.
  // length(), not max(abs()), or the falloff would be a rectangle.
  float r = length((vUv - 0.5) * vAxis) / length(vec2(0.5) * vAxis);
  float mid = uVignetteMid / 100.0;                   // where the falloff starts
  float soft = max(uVignetteFeather / 100.0, 1e-3);   // 0 → hard edge
  float v = smoothstep(mid, mid + soft * (1.0 - mid), r);
  float vAmount = uVignette / 100.0;                  // -1..1
  // Negative multiplies (darkens), positive screens (lightens) — screening keeps
  // a bright sky from flattening to pure white as a multiply > 1 would.
  outRgb = vAmount < 0.0
    ? outRgb * (1.0 + vAmount * v)
    : outRgb + (1.0 - outRgb) * (vAmount * v);

  // Film grain. Applied last (after the vignette, as in Lightroom's Effects
  // panel): the grain sits on the print, so the shaded corners keep theirs.
  //
  // THE DECISION THAT DEFINES IT: the cell size is a fraction of the FRAME, not
  // a count of image pixels and not a count of canvas pixels. Grain is a
  // property of the negative's area, so this is what makes one recipe look the
  // same on a 12 MP and a 45 MP file, and the export look like the preview.
  // Anchoring to canvas pixels instead would let the grain slide over the image
  // while panning; anchoring to image pixels would make it invisible in a
  // fit-to-window preview and only show up in the JPG.
  if (uGrain > 0.0) {
    // Cells across the frame's width, log-mapped so the slider feels even:
    // 1500 (fine) → 150 (chunky). Dividing the vertical count by the frame
    // aspect keeps the cells square on any crop or quarter turn.
    float cells = 1500.0 * pow(0.1, uGrainSize / 100.0);
    vec2 gp = vUv * vec2(cells, cells / max(uFrameAspect, 1e-4));
    float n = valueNoise(gp);
    // Roughness = clumping: a much coarser second octave modulates the fine
    // one's amplitude, so the density wanders instead of reading as even sand.
    // The modulator averages exactly 1 (clump averages 0.5 → 0.3 + 0.7), so
    // roughness changes the grain's *character* and not how loud it is. An
    // off-centre modulator makes the roughness slider double as a second amount
    // slider, which is what made the film presets read as too grainy.
    float clump = valueNoise(gp * 0.15 + 17.3);
    float rough = uGrainRoughness / 100.0;
    float g = (n - 0.5) * 2.0 * mix(1.0, 0.3 + 1.4 * clump, rough);
    // Grain lives in the midtones: none in clipped white, little in pure black.
    // Cubic, so the falloff only bites near the extremes.
    float gLuma = dot(outRgb, LUMA);
    float gWeight = 1.0 - pow(abs(2.0 * gLuma - 1.0), 3.0);
    // Monochrome — the same delta in all three channels. Per-channel noise
    // reads as digital colour noise, not as film.
    //
    // 0.085 = the peak luma swing at grain 100. THIS is the one knob for "the
    // whole feature is too strong / too weak": it rescales every slider value
    // and every preset at once, so calibrate here before touching any recipe.
    outRgb = clamp(outRgb + g * (uGrain / 100.0) * 0.085 * gWeight, 0.0, 1.0);
  }

  // Mask-editing overlay: tint the painted area red so the user sees the mask
  // regardless of its adjustments. Off (uOverlay = 0) during normal viewing.
  float rawAlpha = texture(uOverlayMask, uv).r;
  float mo = (uOverlayInvert > 0.5 ? 1.0 - rawAlpha : rawAlpha) * uOverlay;
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
 * Noise reduction — one 1D pass, run twice (H then V) like the Gaussian above.
 *
 * It runs BEFORE the pixel pipeline (see the pass order in `renderer.ts`), because
 * exposure and the shadow sliders amplify whatever noise reaches them, and clarity
 * and the sharpen amplify it again at the other end. Denoise-then-sharpen is also
 * the only order that works: sharpening first turns noise into "detail" that no
 * filter can tell from the real thing.
 *
 * Digital noise is really two problems, and this shader runs a different filter on
 * each half of the same decomposition:
 *
 * - **Chroma** (the coloured blotches of high-ISO shots): a wide Gaussian on the
 *   two colour channels with an edge guard. Nearly free, because the eye resolves
 *   colour far worse than brightness — a radius that would smear the picture to
 *   mush leaves no visible trace, while the blotches disappear.
 * - **Luminance** (the gritty monochrome speckle): a bilateral, whose range term
 *   is what tells noise from detail. Expensive to get right, and the half that can
 *   flatten a photo into plastic, which is what `uDetail` exists to undo.
 *
 * Both filters share ONE set of texture fetches. That is the reason they live in
 * a single shader instead of two chained passes: with both sliders up, fusing
 * them halves the sampling, and sampling is the scarce resource here.
 */
/**
 * The luma/chroma-opponent space every noise pass works in, shared by the three
 * shaders that touch chroma (the denoise itself, and the pyramid's merge).
 *
 * Interpolated rather than copied because the three MUST agree to the last
 * decimal: the pyramid subtracts one shader's chroma from another's, and a luma
 * weight that differed in the third decimal would leave that difference carrying
 * a sliver of luminance — visible as brightness mottling in exactly the flat
 * areas the pass exists to clean.
 *
 * Not BT.601 either: this is the minimal opponent pair, chosen for two
 * properties the filters depend on.
 *
 * 1. It is EXACTLY reversible. Each pass recomposes to RGB to write its FBO and
 *    the next decomposes again; a lossy round trip would show up as a colour
 *    cast rather than as noise reduction.
 * 2. Green is not stored — toRgb() solves it back out of the luma definition. So
 *    luminance is preserved by construction: touching Cb/Cr *cannot* change how
 *    bright a pixel is. That invariant is what makes a huge chroma radius safe,
 *    and it is what lets the pyramid rewrite chroma across a hundred pixels
 *    without the picture moving.
 */
const YCC_GLSL = `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

/** RGB → (Y, Cb, Cr). */
vec3 toYcc(vec3 rgb) {
  float y = dot(rgb, LUMA);
  return vec3(y, rgb.b - y, rgb.r - y);
}

/** (Y, Cb, Cr) → RGB; green is solved from the luma definition, not stored. */
vec3 toRgb(vec3 ycc) {
  float r = ycc.x + ycc.z;
  float b = ycc.x + ycc.y;
  float g = (ycc.x - 0.2126 * r - 0.0722 * b) / 0.7152;
  return vec3(r, g, b);
}
`

/**
 * The frame's brightness-noise curve and the lookup into it, shared by every
 * pass whose strength has to follow the tone scale — the bilateral, the chroma
 * guard and the non-local means.
 *
 * Interpolated rather than copied for the same reason as {@link YCC_GLSL}: the
 * preview filter and the quality filter must read the curve identically, or
 * letting go of the slider would visibly re-balance the picture between the
 * shadows and the highlights instead of just cleaning it better.
 */
const LUMA_SHAPE_GLSL = `
// How the frame's luma noise is distributed across brightness, measured at load
// (estimateNoise) and normalised so its average is 1. See shapeAt().
uniform float uLumaShape[${NOISE_LUMA_BINS}];

/**
 * The measured noise multiplier at a given luma, interpolated between band
 * centres so the filter's strength varies smoothly rather than in eight steps.
 *
 * Bands are centred at (i + 0.5) / N, hence the half-band shift: sampling at a
 * band's own centre must return that band's value exactly, or a flat curve would
 * come back tilted.
 */
float shapeAt(float y) {
  float bins = float(${NOISE_LUMA_BINS});
  float t = clamp(y, 0.0, 1.0) * bins - 0.5;
  float lower = clamp(floor(t), 0.0, bins - 1.0);
  float upper = min(lower + 1.0, bins - 1.0);
  return mix(uLumaShape[int(lower)], uLumaShape[int(upper)], clamp(t - lower, 0.0, 1.0));
}
`

export const DENOISE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSource;      // H pass: the image; V pass: the H pass's output
uniform sampler2D uOriginal;    // the untouched image, for uDetail
uniform vec2 uDirection;        // per-texel step along this pass's axis
uniform float uColorRadius;     // chroma blur radius in texels (0 = off)
uniform float uLumaRadius;      // luminance bilateral radius in texels (0 = off)
uniform float uEdgeSigma;       // chroma: luma difference that counts as an edge
uniform float uLumaSigmaRange;  // luminance: the bilateral's range sigma
uniform float uDetail;          // 0..1; luminance detail mixed back in
uniform float uFinal;           // 1 on the V pass, where uDetail is applied

${YCC_GLSL}

// Hard cap on taps per side (compile-time loop bound), as in the Gaussian pass.
// 24 comfortably covers COLOR_NOISE_MAX_RADIUS (noise.ts).
const int MAX_TAPS = 24;

${LUMA_SHAPE_GLSL}

void main() {
  vec4 texel = texture(uSource, vUv);
  vec3 centre = toYcc(texel.rgb);

  // Same sigma convention as BLUR_FRAGMENT_SHADER: decayed to ~1% at the radius.
  float maxRadius = max(uColorRadius, uLumaRadius);
  float sigmaC = max(uColorRadius / 3.0, 1e-4);
  float sigmaL = max(uLumaRadius / 3.0, 1e-4);
  float twoSigmaC2 = 2.0 * sigmaC * sigmaC;
  float twoSigmaL2 = 2.0 * sigmaL * sigmaL;

  // How noisy THIS pixel's brightness is, relative to the frame's average. Both
  // range terms below ask "is this neighbour within the noise?", and the answer
  // depends on where in the tone scale the question is asked: after the decoder's
  // gamma, a shadow's noise is several times a highlight's (see noiseEstimate).
  //
  // Evaluated ONCE, from the centre pixel, and deliberately not per tap. A filter
  // whose weights depended on each neighbour's own sigma would stop being
  // symmetric — bright neighbours would count a dark pixel more than the reverse
  // — and an asymmetric weight is how an edge-preserving filter starts dragging
  // edges toward the brighter side.
  float shape = shapeAt(centre.x);
  float edgeSigma = max(uEdgeSigma * shape, 1e-4);
  float rangeSigma = max(uLumaSigmaRange * shape, 1e-4);
  float twoSigmaE2 = 2.0 * edgeSigma * edgeSigma;
  float twoSigmaR2 = 2.0 * rangeSigma * rangeSigma;

  vec2 chromaSum = vec2(0.0);
  float chromaWeight = 0.0;
  float lumaSum = 0.0;
  float lumaWeight = 0.0;

  for (int i = -MAX_TAPS; i <= MAX_TAPS; i++) {
    float fi = float(i);
    if (abs(fi) > maxRadius) { continue; }
    // ONE fetch, TWO filters: this is why they are fused into one shader.
    vec3 s = toYcc(texture(uSource, vUv + uDirection * fi).rgb);
    float dy = s.x - centre.x;

    if (abs(fi) <= uColorRadius) {
      // Edge guard: a neighbour on the far side of a luma edge is a different
      // subject, and averaging its colour in is what bleeds red past a lip or a
      // sign. Weighing by luma difference keeps the blur inside one surface.
      // uEdgeSigma is deliberately loose — see CHROMA_EDGE_SIGMA in noise.ts.
      float w = exp(-(fi * fi) / twoSigmaC2) * exp(-(dy * dy) / twoSigmaE2);
      chromaSum += s.yz * w;
      chromaWeight += w;
    }

    if (abs(fi) <= uLumaRadius) {
      // Bilateral: spatial term × RANGE term. The range term is the whole idea —
      // inside a flat area neighbours differ only by the noise, so they all count
      // and the average cancels it; across an edge the difference is large, the
      // weight collapses and the filter refuses to average over it. That is what
      // separates a denoiser from a blur.
      float w = exp(-(fi * fi) / twoSigmaL2) * exp(-(dy * dy) / twoSigmaR2);
      lumaSum += s.x * w;
      lumaWeight += w;
    }
  }

  // The centre tap has fi = 0 and dy = 0, so its weight is exactly 1 in both
  // filters: neither denominator can be 0, and neither divide needs a guard.
  vec3 result = centre;
  if (uColorRadius > 0.0) { result.yz = chromaSum / chromaWeight; }
  if (uLumaRadius > 0.0) { result.x = lumaSum / lumaWeight; }

  // Detail recovery. Any denoiser takes real detail with it; rather than filter
  // more weakly (which leaves the noise), filter fully and give a fraction of the
  // original luminance back. This is what keeps skin and fabric from going
  // plastic, and it costs a single extra fetch.
  //
  // Applied only on the final pass and against the ORIGINAL image, not against
  // uSource, which on that pass is already filtered in the horizontal direction.
  // Both textures share a coordinate mapping — pass 0 is orientation-preserving
  // (see chromaDenoise1D in renderer.ts) — so the same vUv reads both correctly.
  if (uFinal > 0.5 && uDetail > 0.0 && uLumaRadius > 0.0) {
    float originalLuma = dot(texture(uOriginal, vUv).rgb, LUMA);
    result.x = mix(result.x, originalLuma, uDetail);
  }

  fragColor = vec4(clamp(toRgb(result), 0.0, 1.0), texel.a);
}
`

/**
 * Quarter-size downsample, one step of the chroma pyramid.
 *
 * Exactly a 4×4 box average, in four fetches rather than sixteen: with LINEAR
 * filtering, sampling *between* two texel centres returns their mean for free,
 * so one tap placed at the centre of each 2×2 quadrant is already the average of
 * four texels. That is the difference between a downsample that costs 4 taps and
 * one that costs 16, repeated over every level.
 *
 * A box and not a Gaussian: the pyramid's merge subtracts this level from the
 * one above, and the subtraction only cancels cleanly if both sides went through
 * the *same* low-pass. A box is the cheapest filter for which that holds.
 */
export const DOWNSAMPLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2 uSourceTexel;  // 1 / source size, in UV

void main() {
  vec2 o = uSourceTexel;
  fragColor = 0.25 * (
      texture(uSource, vUv + vec2(-o.x, -o.y))
    + texture(uSource, vUv + vec2( o.x, -o.y))
    + texture(uSource, vUv + vec2(-o.x,  o.y))
    + texture(uSource, vUv + vec2( o.x,  o.y))
  );
}
`

/**
 * Folds a coarser pyramid level's cleaned channels back into a finer one.
 *
 * The operation is a one-level Laplacian correction:
 *
 *     out = fine + (coarseClean − coarseNoisy)
 *
 * and the parenthesis is the point. It is *only* what the coarse denoise
 * changed — the slow mottle it removed — upsampled. Everything finer than the
 * coarse level cancels between the two terms, so every edge and detail in
 * `uFine` survives untouched.
 *
 * The tempting alternative, mixing toward the upsampled coarse level, would
 * instead *replace* fine content with blurred content: on chroma that is how a
 * denoiser bleeds red past a lip or a sign, and on luma it is how it turns a
 * face to wax.
 *
 * `uChannels` picks which of (Y, Cb, Cr) the correction touches, so one program
 * serves both pyramids: `(0,1,1)` for the colour one, `(1,0,0)` for the
 * luminance one. Whichever is not selected passes through *bit for bit*, which
 * is what keeps the two from interfering — the colour pyramid provably cannot
 * change a brightness, and the luminance one provably cannot shift a hue.
 */
export const PYRAMID_MERGE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFine;          // this level, already denoised at its own scale
uniform sampler2D uCoarseClean;   // the level below, denoised
uniform sampler2D uCoarseNoisy;   // the level below, before its denoise
uniform vec3 uChannels;           // which of (Y, Cb, Cr) the correction applies to

${YCC_GLSL}

void main() {
  vec4 fine = texture(uFine, vUv);
  vec3 result = toYcc(fine.rgb);
  // Both coarse levels are sampled at the same vUv and stretched by the GPU's
  // LINEAR filtering, which is the upsample: no explicit interpolation pass.
  vec3 clean = toYcc(texture(uCoarseClean, vUv).rgb);
  vec3 noisy = toYcc(texture(uCoarseNoisy, vUv).rgb);
  result += (clean - noisy) * uChannels;
  fragColor = vec4(clamp(toRgb(result), 0.0, 1.0), fine.a);
}
`

/**
 * Non-local means, part 1 of 3: the horizontal half of one candidate's patch
 * distance.
 *
 * Run once per candidate offset. It writes, for every pixel, the sum of squared
 * luma differences along a horizontal line of the patch between this pixel's
 * neighbourhood and the candidate's. Part 2 sums those lines vertically, which
 * completes the patch.
 *
 * **Why in two passes.** The patch sum is separable, and separating it is what
 * makes the filter affordable: a P×P patch costs `2P` fetches across two passes
 * instead of `P²` in one, and — far more importantly — every pixel's horizontal
 * line is reused by all P rows that overlap it, so the work per pixel stops
 * growing with the patch at all. Done naively, in one shader with four nested
 * loops, this filter needs hundreds of fetches per pixel and takes minutes on a
 * large frame.
 */
export const NLM_DISTANCE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSource;   // the image, in its original state
// This candidate's shift, in UV. NOT named uOffset: the shared vertex shader
// already has a uniform by that name, and a linked program has ONE uniform per
// name across its stages — writing this would have panned the quad as well.
uniform vec2 uShift;
uniform vec2 uTexel;         // 1 / image size

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const int PATCH = ${NLM_PATCH_RADIUS};

void main() {
  float sum = 0.0;
  for (int i = -PATCH; i <= PATCH; i++) {
    vec2 at = vUv + vec2(float(i) * uTexel.x, 0.0);
    float here = dot(texture(uSource, at).rgb, LUMA);
    float there = dot(texture(uSource, at + uShift).rgb, LUMA);
    sum += (here - there) * (here - there);
  }
  fragColor = vec4(sum, 0.0, 0.0, 1.0);
}
`

/**
 * Non-local means, part 2 of 3: finish the patch distance, weigh the candidate,
 * and add it to the running totals.
 *
 * The weight is `exp(−max(d² − 2σ², 0) / h²)` — see NLM_H in `nlm.ts` for why
 * the `2σ²` is subtracted and what `h` decides. σ follows the frame's brightness
 * curve, exactly as the bilateral's range term does, so the filter works harder
 * in the shadows where the noise actually is.
 *
 * The totals are carried through a ping-ponged texture rather than accumulated
 * with additive blending. Blending would save a fetch, but it is only guaranteed
 * on float targets by an extension this pass would then depend on, and the
 * fetch is free next to the patch work already done above it.
 */
export const NLM_ACCUMULATE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uDistance;  // part 1's output for this candidate
uniform sampler2D uSource;    // the image, in its original state
uniform sampler2D uAccum;     // totals so far: (sum of w*luma, sum of w)
uniform vec2 uShift;          // this candidate's shift, in UV (see the note above)
uniform vec2 uTexel;          // 1 / image size
uniform float uSigma;         // measured noise sigma, before the brightness curve
uniform float uH;             // strength, as a multiple of sigma

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const int PATCH = ${NLM_PATCH_RADIUS};

${LUMA_SHAPE_GLSL}

void main() {
  float distance = 0.0;
  for (int i = -PATCH; i <= PATCH; i++) {
    distance += texture(uDistance, vUv + vec2(0.0, float(i) * uTexel.y)).r;
  }
  // A mean, not a sum: h is expressed in luma units, so the distance it is
  // compared against has to be per-pixel too, whatever the patch size.
  distance /= float(${NLM_PATCH_PIXELS});

  float centre = dot(texture(uSource, vUv).rgb, LUMA);
  float sigma = max(uSigma * shapeAt(centre), 1e-5);
  float h = max(uH * sigma, 1e-5);
  // Two patches of the SAME signal, seen through independent noise, differ by
  // 2*sigma^2 on average. Subtracting it makes a true match score zero and take
  // a weight of 1, so the filter needs no threshold to average confidently.
  float excess = max(distance - 2.0 * sigma * sigma, 0.0);
  float weight = exp(-excess / (h * h));

  float neighbour = dot(texture(uSource, vUv + uShift).rgb, LUMA);
  vec2 totals = texture(uAccum, vUv).rg;
  fragColor = vec4(totals.r + weight * neighbour, totals.g + weight, 0.0, 1.0);
}
`

/**
 * Non-local means, part 3 of 3: divide the totals and rebuild a picture.
 *
 * Luminance comes from the accumulation, chroma from whatever the chroma half of
 * the denoise produced, and the two are recombined through the shared opponent
 * space. That separation is the reason the quality pass costs what it costs and
 * no more: the expensive filter runs on one channel, the one the eye resolves.
 */
export const NLM_RESOLVE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uAccum;     // (sum of w*luma, sum of w)
uniform sampler2D uChroma;    // the frame with its chroma already cleaned
uniform sampler2D uOriginal;  // the untouched image, for the detail mix
uniform float uDetail;        // 0..1; original luminance mixed back in

${YCC_GLSL}

void main() {
  vec4 chroma = texture(uChroma, vUv);
  vec3 result = toYcc(chroma.rgb);
  float original = dot(texture(uOriginal, vUv).rgb, LUMA);

  vec2 totals = texture(uAccum, vUv).rg;
  // The centre is one of the candidates and always weighs 1, so the total can
  // only be zero if the pass never ran. Falling back to the original then is
  // what keeps a skipped frame looking like the photo rather than like black.
  float filtered = totals.g > 0.0 ? totals.r / totals.g : original;

  result.x = mix(filtered, original, uDetail);
  fragColor = vec4(clamp(toRgb(result), 0.0, 1.0), chroma.a);
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
${EXPOSURE_GLSL}

void main() {
  vec4 texel = texture(uImage, vUv);
  vec3 base = texel.rgb;
  vec3 rgb = applyExposure(base, uExposure);
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
 * Local-contrast amount map: turns "how much texture" from a single uniform into
 * a per-pixel value, so masks can carry it.
 *
 * The idea rests on one property of the composite: texture enters it **linearly
 * in its amount** (`Lp = L + w * (… + textureAmt * Ds)`). Nothing requires
 * `textureAmt` to be a uniform — a texel works just as well. So this pass builds
 * `global + Σ (maskAlpha_i × maskTexture_i)` once, and the composite reads it.
 *
 * That is what keeps the cost flat. The alternative — blurring the image again
 * per mask so each mask pass could do its own unsharp mask — would add two
 * full-resolution passes per mask; this adds one trivial draw per mask and no
 * neighbourhood sampling at all. And because the composite still works off the
 * blur of the FINAL developed image, the result is the one you want.
 *
 * **Signed values in an RGBA8 target.** Amounts run -5..5 and a normalised
 * target cannot hold negatives, so positive and negative contributions
 * accumulate in SEPARATE channels (`.r` and `.g`) under additive blending, and
 * the composite takes `r - g`. Two things fall out of that for free: the clamp
 * to ±`RANGE` is the framebuffer's own saturation, and each channel keeps the
 * full 8 bits over 0..RANGE instead of splitting them around a 0.5 midpoint.
 */
export const AMOUNT_MAP_RANGE = 5

export const AMOUNT_MAP_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uMask;   // this mask's alpha (weight in .r); ignored when uUseMask = 0
uniform float uAmount;     // this contribution's slider value, -5..5
uniform float uInvert;     // 1 → the mask affects the area outside the selection
uniform float uUseMask;    // 0 → the global slider: full weight everywhere

// The encoding's full scale, and therefore the cap on the accumulated amount.
// Matches the sliders' own range: stacking a global +5 with a mask's +5 saturates
// here rather than running off to +10, where the effect is meaningless anyway.
// Interpolated from AMOUNT_MAP_RANGE so the decode in the composite cannot drift
// away from the encode here.
const float RANGE = ${AMOUNT_MAP_RANGE.toFixed(1)};

void main() {
  float weight = 1.0;
  if (uUseMask > 0.5) {
    weight = clamp(texture(uMask, vUv).r, 0.0, 1.0);
    weight = mix(weight, 1.0 - weight, uInvert);
  }
  float value = weight * uAmount / RANGE;   // -1..1
  // Split by sign; the caller draws these additively, one draw per contribution.
  // Alpha contributes 0 so repeated draws cannot saturate a channel nobody reads.
  fragColor = vec4(max(value, 0.0), max(-value, 0.0), 0.0, 0.0);
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

/**
 * Linear-gradient rasteriser — vertex stage. A bare full-screen quad with no
 * uniforms: `vUv` runs 0..1 with `vUv.y = 0` at the image top, matching the
 * brush stamp's stored orientation (`renderer.ts` stamps `py/H`), so a rasterised
 * ramp lines up with everything else the pipeline draws. Own shader rather than
 * reusing `VERTEX_SHADER` so there is no `uScale`/`uOffset`/`uFlipV` to remember
 * to set on this program.
 */
export const GRADIENT_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;            // vUv.y = 0 → image top
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/**
 * Linear-gradient rasteriser — fragment stage. Writes a weight that is 1 on the
 * line through `uP1` (perpendicular to P1→P2), 0 on the line through `uP2`, and
 * ramps linearly between — Lightroom's three-line model.
 *
 * The projection runs in image PIXELS, not normalised UV: in UV the aspect ratio
 * warps the metric, so the iso-lines would not come out perpendicular to the
 * dragged line on any non-square photo. Hence `uImageSize`.
 */
export const GRADIENT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uP1;         // image px — full-effect line (w = 1)
uniform vec2 uP2;         // image px — zero-effect line (w = 0)
uniform vec2 uImageSize;  // (W, H) in px
void main() {
  vec2 p = vUv * uImageSize;         // to PIXELS before anything else
  vec2 d = uP2 - uP1;
  float dd = dot(d, d);
  // p1 == p2 (a click with no drag) → no direction: empty mask, not NaN.
  float t = dd > 0.0 ? clamp(dot(p - uP1, d) / dd, 0.0, 1.0) : 1.0;
  float w = 1.0 - t;
  fragColor = vec4(w, w, w, w);      // the mask shader reads .r
}
`

/**
 * Radial-gradient rasteriser — fragment stage. Writes a weight that is 1 at the
 * ellipse centre and falls off smoothly to 0 at its boundary (and stays 0
 * outside) — the radial analogue of the linear ramp above. Reuses
 * `GRADIENT_VERTEX_SHADER` (bare quad, `vUv.y = 0` at the image top).
 *
 * Like the linear ramp, the maths runs in image PIXELS, not UV: in UV the aspect
 * ratio warps the metric, so a circle would render as an ellipse on any
 * non-square photo. The sample is rotated into the ellipse's own axes and each
 * axis divided by its radius, collapsing the ellipse to the unit circle, so a
 * single `length()` gives the normalised distance `d` (1 on the boundary).
 *
 * Feather is not a field on `RadialShape`, so the falloff spans the whole radius
 * (`smoothstep(0,1,d)`). To get a Lightroom-style solid core + edge feather,
 * add a `feather` (0..1) to `RadialShape`, pass it as a uniform and ramp over
 * `smoothstep(1.0 - feather, 1.0, d)` instead.
 */
export const RADIAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uCenter;      // image px — ellipse centre (cx, cy)
uniform vec2 uRadii;       // image px — semi-axes (rx, ry), before rotation
uniform float uRotation;   // degrees; positive turns the ellipse clockwise on screen
uniform vec2 uImageSize;   // (W, H) in px
uniform float uFeather;
void main() {
  vec2 p = vUv * uImageSize;          // to PIXELS before anything else
  vec2 q = p - uCenter;
  float a = radians(uRotation);
  float ca = cos(a);
  float sa = sin(a);
  // Rotate the sample into the ellipse's own axes (by -rotation), then normalise
  // each axis by its radius: the ellipse becomes the unit circle, so d = 1 on the
  // boundary, < 1 inside, > 1 outside.
  vec2 local = vec2(q.x * ca + q.y * sa, -q.x * sa + q.y * ca);
  vec2 r = max(uRadii, vec2(1e-4));   // rx/ry == 0 (no drag yet) → no divide-by-zero
  float d = length(local / r);
  float w = 1.0 - smoothstep(1.0 - clamp(uFeather, 0.0, 1.0), 1.0, d);
  fragColor = vec4(w, w, w, w);       // the mask shader reads .r
}
`

/** Pixel pipeline: exposure → highlights → shadows → whites → blacks → contrast → temp/tint → vibrance → saturation → colour grading → curves → sharpness/threshold. */
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
// Colour grading: one zone each, packed as (hue in degrees, saturation 0..100,
// luminance -100..100), plus the two shape controls of the zone split.
uniform vec3 uGradeShadow;
uniform vec3 uGradeMid;
uniform vec3 uGradeHigh;
uniform float uGradeBlending;
uniform float uGradeBalance;
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
${EXPOSURE_GLSL}
${GRADING_GLSL}

void main() {
  vec4 texel = texture(uImage, vUv);
  vec3 rgb = applyExposure(texel.rgb, uExposure);
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
  // Colour grading, after saturation and before the curves. After, because a
  // global saturation applied later would amplify the tint the wheels just laid
  // down; before, because the curve is the last global shaper of tone and moving
  // a point would otherwise redistribute which pixels each zone owns.
  rgb = applyGrading(rgb, uGradeShadow, uGradeMid, uGradeHigh, uGradeBlending, uGradeBalance);
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
