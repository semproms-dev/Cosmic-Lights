import { clamp, MIN_CROP_SIZE } from "../utils";
import type { CropRegion } from "./image";
import { applyInverseUvTransform, applyUvTransform, uvTransform, type Orientation } from "./rotation";
import { IDENTITY_GEOMETRY, type Geometry } from "./geometry";
import type { CropOrientation } from "./editorReducer";

export const clampCropRegion =(region: CropRegion, imageWidth: number, imageHeight: number): CropRegion => {
    const width = clamp(region.width, MIN_CROP_SIZE, imageWidth);
    const height = clamp(region.height, MIN_CROP_SIZE, imageHeight);

    const x = clamp(region.x, 0, imageWidth - width);
    const y = clamp(region.y, 0, imageHeight - height);

    return {width, height, x, y};
}

/** A rectangle in container/CSS pixels: where something sits on screen. */
export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The interactive zoom/pan the renderer folds into its letterbox, in clip space:
 * a point at `p` is drawn at `p * scale + offset`.
 */
export interface CanvasView {
  scale: number
  offsetX: number
  offsetY: number
}

/** Fit-to-canvas, no zoom, no pan. */
export const IDENTITY_VIEW: CanvasView = { scale: 1, offsetX: 0, offsetY: 0 }

/**
 * Undoes the zoom/pan: turns a point where the user actually clicked into the
 * point it would occupy in the fitted, un-zoomed layout.
 *
 * Everything else in this module (the letterbox, {@link canvasToImageCoords})
 * assumes that fitted layout, so any pointer position must come through here
 * first or the mapping is off by exactly the zoom factor.
 *
 * @param point - Position in container/CSS pixels, as the pointer reports it.
 * @param containerWidth - Container width in CSS pixels.
 * @param containerHeight - Container height in CSS pixels.
 * @param view - The active zoom/pan.
 * @returns The same position in the fitted layout's pixels.
 */
export const viewToBasePoint = (
  point: { x: number; y: number },
  containerWidth: number,
  containerHeight: number,
  view: CanvasView,
): { x: number; y: number } => {
  const clipX = (point.x / containerWidth) * 2 - 1
  const clipY = 1 - (point.y / containerHeight) * 2
  const baseX = (clipX - view.offsetX) / view.scale
  const baseY = (clipY - view.offsetY) / view.scale
  return {
    x: ((baseX + 1) / 2) * containerWidth,
    y: ((1 - baseY) / 2) * containerHeight,
  }
}

/**
 * Applies the zoom/pan: the inverse of {@link viewToBasePoint}. Use it to draw
 * something computed in the fitted layout where the user can actually see it.
 */
export const baseToViewPoint = (
  point: { x: number; y: number },
  containerWidth: number,
  containerHeight: number,
  view: CanvasView,
): { x: number; y: number } => {
  const baseX = (point.x / containerWidth) * 2 - 1
  const baseY = 1 - (point.y / containerHeight) * 2
  const clipX = baseX * view.scale + view.offsetX
  const clipY = baseY * view.scale + view.offsetY
  return {
    x: ((clipX + 1) / 2) * containerWidth,
    y: ((1 - clipY) / 2) * containerHeight,
  }
}

/**
 * Applies the zoom/pan to a whole rectangle. The zoom is uniform on both axes,
 * so the size just scales.
 */
export const baseToViewRect = (
  rect: DisplayRect,
  containerWidth: number,
  containerHeight: number,
  view: CanvasView,
): DisplayRect => {
  const origin = baseToViewPoint(rect, containerWidth, containerHeight, view)
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * view.scale,
    height: rect.height * view.scale,
  }
}

/**
 * The rectangle (in container/CSS pixels) that a letterboxed image occupies
 * inside a container of the given size. Mirrors the renderer's Pass 4 letterbox
 * math (`renderer.ts` ~lines 387-398): the image is centered and scaled to fit
 * without stretching, leaving bars on the axis that would otherwise overflow.
 *
 * @param imageWidth  image width in pixels (or the crop's width when zoomed).
 * @param imageHeight image height in pixels (or the crop's height when zoomed).
 * @param containerWidth  container width in CSS pixels.
 * @param containerHeight container height in CSS pixels.
 */
export const getImageDisplayRect = (
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
): DisplayRect => {
  const containerAspect = containerWidth / containerHeight
  const imageAspect = imageWidth / imageHeight

  let width = containerWidth
  let height = containerHeight
  if (imageAspect > containerAspect) {
    height = containerWidth / imageAspect
  } else {
    width = containerHeight * imageAspect
  }

  const x = (containerWidth - width) / 2
  const y = (containerHeight - height) / 2

  return { x, y, width, height }
}

/**
 * Maps a crop region (image pixels) to its on-screen rectangle in container/CSS
 * pixels, accounting for the letterbox. The forward transform used to paint the
 * overlay's frame, mask and handles.
 */
export const imageToCanvasCoords = (
  region: CropRegion,
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
): DisplayRect => {
  const disp = getImageDisplayRect(imageWidth, imageHeight, containerWidth, containerHeight)

  return {
    x: disp.x + (region.x / imageWidth) * disp.width,
    y: disp.y + (region.y / imageHeight) * disp.height,
    width: (region.width / imageWidth) * disp.width,
    height: (region.height / imageHeight) * disp.height,
  }
}

/**
 * Maps a point in container/CSS pixels back to image pixels — the inverse of
 * {@link imageToCanvasCoords}. Pointer events land in container space; the draft
 * crop lives in image space, so this converts on every drag. Points outside the
 * letterboxed image map outside `[0, imageWidth] × [0, imageHeight]`; callers
 * clamp with {@link clampCropRegion}.
 */
export const canvasToImageCoords = (
  point: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } => {
  const disp = getImageDisplayRect(imageWidth, imageHeight, containerWidth, containerHeight)

  return {
    x: ((point.x - disp.x) / disp.width) * imageWidth,
    y: ((point.y - disp.y) / disp.height) * imageHeight,
  }
}

/**
 * Maps a pointer position to image pixels, honouring everything the renderer
 * does to get the image on screen — in the same order, inverted.
 *
 * There are three transforms between a click and a pixel, and missing any one
 * fails silently (the mark simply lands somewhere else):
 *
 * 1. the interactive zoom/pan ({@link viewToBasePoint}),
 * 2. the letterbox — which fits the frame **as displayed**: the crop region when
 *    one is applied rather than the full frame, and with its axes swapped on an
 *    odd quarter turn, and
 * 3. the orientation itself — the turns and mirrors.
 *
 * Steps 2 and 3 are not re-derived here. The renderer's own remap
 * (`uvTransform`) already answers "which source pixel lands on this output
 * point?", which is exactly this question, so this asks it instead of inverting
 * it by hand: one definition, no drift. With an upright, unmirrored orientation
 * it reduces exactly to the plain letterbox mapping it replaces.
 *
 * Anything that turns a pointer into an image pixel must come through here, or
 * it will quietly disagree with what the user sees.
 *
 * @param point - Pointer position in container/CSS pixels.
 * @param containerWidth - Container width in CSS pixels.
 * @param containerHeight - Container height in CSS pixels.
 * @param imageWidth - Full image width in pixels.
 * @param imageHeight - Full image height in pixels.
 * @param crop - The crop the canvas is *currently displaying*, or `null` for the
 * full frame. Pass `null` while the crop tool is open: it shows the full frame.
 * @param view - The active zoom/pan.
 * @param orientation - The turns and mirroring the canvas is displaying.
 * @param geometry - The lens/perspective/scale/offset the canvas is displaying.
 * Defaults to the identity, so a caller with nothing to say about it behaves
 * exactly as before.
 * @returns The position in full-image pixels.
 */
export const pointerToImagePoint = (
  point: { x: number; y: number },
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  crop: CropRegion | null,
  view: CanvasView,
  orientation: Orientation,
  geometry: Geometry = IDENTITY_GEOMETRY,
): { x: number; y: number } => {
  const base = viewToBasePoint(point, containerWidth, containerHeight, view)

  // The letterbox fits the frame the user sees, so an odd turn stands it on its
  // end here too — exactly as `uvTransform`'s `displayedAspect` reports it.
  const frameWidth = crop?.width ?? imageWidth
  const frameHeight = crop?.height ?? imageHeight
  const turned = orientation.quarterTurns % 2 === 1
  const disp = getImageDisplayRect(
    turned ? frameHeight : frameWidth,
    turned ? frameWidth : frameHeight,
    containerWidth,
    containerHeight,
  )

  // Where the point sits on the displayed quad, [0,1]² y-down — the shader's
  // `vUv`. Points outside the letterboxed frame fall outside that range and map
  // outside the image, which callers clamp.
  const vUv = {
    x: (base.x - disp.x) / disp.width,
    y: (base.y - disp.y) / disp.height,
  }
  const uv = applyUvTransform(uvTransform(orientation, crop, imageWidth, imageHeight, geometry), vUv)
  return { x: uv.x * imageWidth, y: uv.y * imageHeight }
}

/**
 * Maps a crop region (image pixels) to the on-screen rectangle in container/CSS
 * pixels, honouring everything the renderer does to place the image: the zoom/pan,
 * the letterbox fitted to the orientation's displayed frame, the quarter turns,
 * the flips and the free straighten angle.
 *
 * A crop is axis-aligned in image space. Quarter turns and mirrors map it to an
 * axis-aligned rectangle on the screen, and the free angle only grows the
 * letterboxed frame (its {@link rotatedBoundingBox}); the screen rectangle is
 * therefore just the bounding box of the four mapped corners. Using
 * {@link imagePointToPointer} here keeps this a mirror of
 * {@link pointerToImagePoint}, so the frame cannot peel away from the canvas the
 * moment a turn, flip or straighten is applied — the same class of bug the crop
 * tool already paid for once with the plain letterbox mapping.
 *
 * `crop` is always `null` here: the crop tool opens on the full frame, exactly
 * what the Canvas is showing while `cropping` is true.
 *
 * @param region - The crop region in image pixels.
 * @param containerWidth - Container width in CSS pixels.
 * @param containerHeight - Container height in CSS pixels.
 * @param imageWidth - Full image width in pixels.
 * @param imageHeight - Full image height in pixels.
 * @param view - The active zoom/pan.
 * @param orientation - The turns and mirroring the canvas is displaying.
 * @param geometry - The lens/perspective/scale/offset the canvas is displaying.
 * @returns The region's on-screen rectangle in container/CSS pixels.
 */
export const cropRegionToViewRect = (
  region: CropRegion,
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  view: CanvasView,
  orientation: Orientation,
  geometry: Geometry = IDENTITY_GEOMETRY,
): DisplayRect => {
  const corners = [
    { x: region.x, y: region.y },
    { x: region.x + region.width, y: region.y },
    { x: region.x, y: region.y + region.height },
    { x: region.x + region.width, y: region.y + region.height },
  ]
  const points = corners.map((p) =>
    imagePointToPointer(p, containerWidth, containerHeight, imageWidth, imageHeight, null, view, orientation, geometry),
  )
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  }
}

export const effectiveAspect = (
  ratio: string,
  orientation: CropOrientation,
  imageWidth: number,
  imageHeight: number
): number | null => {

  const aspectRatio = parseAspectRatio(ratio, imageWidth, imageHeight);
  if(aspectRatio === null) return null;
  return orientation === 'portrait' ? 1 / aspectRatio : aspectRatio;

}

/**
 * Maps a point in full-image pixels to its pointer position in container/CSS
 * pixels — the exact inverse of {@link pointerToImagePoint}, in reverse order.
 *
 * The overlay authors its geometry in image space (so it survives zoom, pan,
 * crop and orientation unchanged) and calls this only at paint time to place each
 * line and handle where the user sees it. It must stay a mirror of the forward
 * map: if the two drift, the overlay peels away from the mask the moment you zoom
 * or rotate — the same class of bug the crop tool already paid for once.
 *
 * @param point - Position in full-image pixels.
 * @param containerWidth - Container width in CSS pixels.
 * @param containerHeight - Container height in CSS pixels.
 * @param imageWidth - Full image width in pixels.
 * @param imageHeight - Full image height in pixels.
 * @param crop - The crop the canvas is *currently displaying*, or `null`.
 * @param view - The active zoom/pan.
 * @param orientation - The turns and mirroring the canvas is displaying.
 * @param geometry - The lens/perspective/scale/offset the canvas is displaying.
 * @returns The position in container/CSS pixels.
 */
export const imagePointToPointer = (
  point: { x: number; y: number },
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
  crop: CropRegion | null,
  view: CanvasView,
  orientation: Orientation,
  geometry: Geometry = IDENTITY_GEOMETRY,
): { x: number; y: number } => {
  // Image pixels → image UV → the point on the displayed quad (undoing crop and
  // orientation through the same transform the forward map applied).
  const uv = { x: point.x / imageWidth, y: point.y / imageHeight }
  const vUv = applyInverseUvTransform(uvTransform(orientation, crop, imageWidth, imageHeight, geometry), uv)

  // The displayed frame stands on its end on an odd turn, exactly as the forward
  // map's letterbox does.
  const frameWidth = crop?.width ?? imageWidth
  const frameHeight = crop?.height ?? imageHeight
  const turned = orientation.quarterTurns % 2 === 1
  const disp = getImageDisplayRect(
    turned ? frameHeight : frameWidth,
    turned ? frameWidth : frameHeight,
    containerWidth,
    containerHeight,
  )

  const base = {
    x: disp.x + vUv.x * disp.width,
    y: disp.y + vUv.y * disp.height,
  }
  return baseToViewPoint(base, containerWidth, containerHeight, view)
}

/**
 * The scale from image pixels to CSS pixels on screen — what the canvas is
 * showing, so the crop region when one is applied. Use it to size anything drawn
 * in screen space from an image-space measurement (e.g. the brush cursor).
 */
export const displayScale = (
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
  crop: CropRegion | null,
  view: CanvasView,
): number => {
  const width = crop?.width ?? imageWidth
  const height = crop?.height ?? imageHeight
  return Math.min(containerWidth / width, containerHeight / height) * view.scale
}

/**
 * Translates a panel aspect-ratio label to a numeric ratio (width / height), or
 * `null` when there is no constraint ('Free'). 'Original' derives the ratio from
 * the image dimensions; 'W:H' labels are parsed as `W / H`.
 *
 * @param label - The selected label ('Original', '1:1', '16:9', …, 'Free').
 * @param imageWidth - Image width in pixels (used for 'Original').
 * @param imageHeight - Image height in pixels (used for 'Original').
 * @returns The numeric aspect ratio, or `null` for a free (unconstrained) crop.
 */
export const parseAspectRatio = (
  label: string,
  imageWidth: number,
  imageHeight: number,
): number | null => {
  if (label === 'Free') return null
  if (label === 'Original') return imageWidth / imageHeight
  const [w, h] = label.split(':').map(Number) // '16:9' → [16, 9]
  if (!w || !h) return null // unexpected label → no constraint
  return w / h
}

/** The orientation a crop opens with: landscape, as the label reads it. */
export const DEFAULT_CROP_ORIENTATION: CropOrientation = 'landscape'


/**
 * The anchor (corner/edge that stays fixed) for the handle at `(fx, fy)`. It is
 * the position opposite the grabbed handle, so `constrainAspectRatio` shrinks the
 * box toward it. `fx`/`fy` are the handle's fractional position in `{0, 0.5, 1}`.
 *
 * @param fx - Handle horizontal fraction (0 = left, 0.5 = middle, 1 = right).
 * @param fy - Handle vertical fraction (0 = top, 0.5 = middle, 1 = bottom).
 * @returns The opposite anchor, e.g. `(0,0)` → `'bottom-right'`.
 */
export const anchorForHandle = (fx: number, fy: number): string => {
  const v = fy === 0 ? 'bottom' : fy === 1 ? 'top' : '' // opposite Y edge
  const h = fx === 0 ? 'right' : fx === 1 ? 'left' : '' // opposite X edge
  if (v && h) return `${v}-${h}` // corner: 'bottom-right', 'top-left', …
  return v || h || 'center' // edge: 'bottom' | 'top' | 'right' | 'left'
}

export const constrainAspectRatio = (region: CropRegion, aspect: number, anchor: string): CropRegion => {
  const { x, y, width, height } = region
  const currentAspect = width / height

  if (Math.abs(currentAspect - aspect) < 1e-9) {
    return region
  }

  if (currentAspect > aspect) {
    const newWidth = height * aspect
    let newX: number

    switch (anchor) {
      case 'top-right':
      case 'right':
      case 'bottom-right':
        newX = x + (width - newWidth)
        break
      case 'center':
        newX = x + (width - newWidth) / 2
        break
      default:
        newX = x
        break
    }

    return { x: newX, y, width: newWidth, height }
  } else {
    const newHeight = width / aspect
    let newY: number

    switch (anchor) {
      case 'bottom-left':
      case 'bottom':
      case 'bottom-right':
        newY = y + (height - newHeight)
        break
      case 'center':
        newY = y + (height - newHeight) / 2
        break
      default:
        newY = y
        break
    }

    return { x, y: newY, width, height: newHeight }
  }
}

/**
 * Re-fits a crop to a new target aspect keeping its area (and center), so the
 * frame does not shrink every time the ratio or orientation changes. When the
 * image cannot hold that area in the new orientation the overflowing axis is
 * locked to the bound and the other derived from the ratio. The result is
 * clamped and re-constrained, so it always matches `aspect` exactly.
 *
 * @param region - The crop before the constraint changed, in image pixels.
 * @param aspect - The new target width/height ratio.
 * @param imageWidth - Image width in pixels.
 * @param imageHeight - Image height in pixels.
 * @returns A centered region with the new aspect and the same area as `region`.
 */
export const refitCrop = (
  region: CropRegion,
  aspect: number,
  imageWidth: number,
  imageHeight: number,
): CropRegion => {
  const area = region.width * region.height
  let width = Math.sqrt(area * aspect)
  let height = area / width

  if (width > imageWidth) {
    width = imageWidth
    height = width / aspect
  }
  if (height > imageHeight) {
    height = imageHeight
    width = height * aspect
  }

  const centered: CropRegion = {
    x: region.x + (region.width - width) / 2,
    y: region.y + (region.height - height) / 2,
    width,
    height,
  }
  // `clampCropRegion` may nudge a tiny region up to MIN_CROP_SIZE; re-constrain
  // so the returned box still matches the target aspect exactly.
  return constrainAspectRatio(clampCropRegion(centered, imageWidth, imageHeight), aspect, 'center')
}
