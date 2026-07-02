/**
 * GLSL sources for the editor pipeline. WebGL2 (`#version 300 es`).
 *
 * The vertex shader draws a single full-screen quad and scales it in clip space
 * so the image keeps its aspect ratio (letterboxed) inside the canvas. The
 * fragment shader is the pixel pipeline: for now only exposure, but every future
 * adjustment plugs in here as another uniform and a couple of lines.
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

/** Pixel pipeline. Slice 1: exposure only (rgb *= 2^stops). */
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform float uExposure;
uniform float uContrast;

void main() {
  vec4 texel = texture(uImage, vUv);
  vec3 rgb = texel.rgb * exp2(uExposure);
  float k = 1.0 + uContrast / 100.0;
  rgb = (rgb - 0.5) * k + 0.5;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), texel.a);
}
`
