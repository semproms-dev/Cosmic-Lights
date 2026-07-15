import { clamp, MIN_CROP_SIZE } from "../utils";
import type { CropRegion } from "./image";

export const cropToUvTransform = (region: CropRegion, imageWidth: number, imageHeight: number) => {
      let { x, y, width, height } = region
      const offsetX = x / imageWidth;
      const offsetY = y / imageHeight;

      const scaleX = width / imageWidth;
      const scaleY = height / imageHeight;

      return {offsetX, offsetY, scaleX, scaleY}
}

export const clampCropRegion = (region: CropRegion, imageWidth: number, imageHeight: number): CropRegion => {
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
 * There are two transforms between a click and a pixel, and missing either one
 * fails silently (the mark simply lands somewhere else):
 *
 * 1. the interactive zoom/pan ({@link viewToBasePoint}), and
 * 2. the letterbox — which fits the **crop region** when one is applied, not the
 *    full frame, so a cropped image maps through the crop's own box.
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
): { x: number; y: number } => {
  const base = viewToBasePoint(point, containerWidth, containerHeight, view)
  if (crop === null) {
    return canvasToImageCoords(base, imageWidth, imageHeight, containerWidth, containerHeight)
  }
  // The canvas shows the crop letterboxed by its own aspect, so map into the
  // crop's box and then shift by where that box sits in the image.
  const inCrop = canvasToImageCoords(base, crop.width, crop.height, containerWidth, containerHeight)
  return { x: crop.x + inCrop.x, y: crop.y + inCrop.y }
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
