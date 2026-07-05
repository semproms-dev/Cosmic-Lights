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
