/**
 * GLSL sources for the editor pipeline. WebGL2 (`#version 300 es`).
 *
 * The vertex shader draws a single full-screen quad and scales it in clip space
 * so the image keeps its aspect ratio (letterboxed) inside the canvas. The
 * fragment shader is the pixel pipeline: exposure, contrast and highlights so
 * far; every future adjustment plugs in here as another uniform and a couple of
 * lines.
 */

/** Full-screen quad; `uScale` letterboxes the image to preserve its aspect. */
export const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
uniform vec2 uScale;
out vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  // WebGL's texture origin is bottom-left but the image's is top-left, so flip
  // the vertical texture coordinate to draw the image the right way up.
  vUv.y = 1.0 - vUv.y;
  gl_Position = vec4(aPos * uScale, 0.0, 1.0);
}
`

/** Pixel pipeline: exposure → highlights → shadows → whites → blacks → contrast → temp/tint → vibrance → saturation. */
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
  float luma = clamp(dot(rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
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
  float lumaC = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  // Vibrance boosts muted pixels more (weighted by 1 - current saturation);
  // saturation scales every pixel uniformly.
  float curSat = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
  rgb = mix(vec3(lumaC), rgb, 1.0 + vib * (1.0 - curSat));
  rgb = mix(vec3(lumaC), rgb, 1.0 + sat);
  fragColor = vec4(clamp(rgb, 0.0, 1.0), texel.a);
}
`
