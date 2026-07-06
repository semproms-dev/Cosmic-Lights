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
