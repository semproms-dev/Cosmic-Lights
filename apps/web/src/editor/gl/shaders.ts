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

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// Hard cap on taps per side (compile-time loop bound), as in the Gaussian pass.
// 24 comfortably covers COLOR_NOISE_MAX_RADIUS (noise.ts).
const int MAX_TAPS = 24;

/**
 * RGB → (Y, Cb, Cr). Not BT.601: this is the minimal opponent pair, and it is
 * chosen for two properties the filter depends on.
 *
 * 1. It is EXACTLY reversible. The horizontal pass recomposes to RGB to write its
 *    FBO and the vertical pass decomposes again; a lossy round trip would show up
 *    as a colour cast rather than as noise reduction.
 * 2. Green is not stored — toRgb() solves it back out of the luma definition. So
 *    luminance is preserved by construction: touching Cb/Cr *cannot* change how
 *    bright a pixel is. That invariant is what makes a huge chroma radius safe.
 */
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

void main() {
  vec4 texel = texture(uSource, vUv);
  vec3 centre = toYcc(texel.rgb);

  // Same sigma convention as BLUR_FRAGMENT_SHADER: decayed to ~1% at the radius.
  float maxRadius = max(uColorRadius, uLumaRadius);
  float sigmaC = max(uColorRadius / 3.0, 1e-4);
  float sigmaL = max(uLumaRadius / 3.0, 1e-4);
  float twoSigmaC2 = 2.0 * sigmaC * sigmaC;
  float twoSigmaL2 = 2.0 * sigmaL * sigmaL;
  float twoSigmaE2 = 2.0 * max(uEdgeSigma, 1e-4) * max(uEdgeSigma, 1e-4);
  float twoSigmaR2 = 2.0 * max(uLumaSigmaRange, 1e-4) * max(uLumaSigmaRange, 1e-4);

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
