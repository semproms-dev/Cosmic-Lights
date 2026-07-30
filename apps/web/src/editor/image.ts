import type { Metadata } from "libraw-wasm";
import type { ImageSource } from "./decodeImage";

export interface LoadedImage {
    bitmap: ImageBitmap,
    width: number,
    height: number,
    fileName: string,
    /**
     * Which decoder produced these pixels. Ask this, never the file name: the
     * name is what the user's disk claims, this is what actually worked — a JPEG
     * renamed to `.nef` still lands here as `'developed'`.
     */
    source: ImageSource,
    /**
     * Camera metadata, or `null` for an already-developed file (JPEG): those are
     * decoded by the browser, which hands over pixels and nothing else. Every
     * reader must cope with its absence — the Info panel shows blanks and the
     * export skips the EXIF block.
     */
    metadata: Metadata | null,
}

export type ImageState = LoadedImage | null;
export type ImageStatus = 'idle' | 'loading' | 'error';


export interface CropRegion {
    x: number,
    y: number,
    width: number,
    height: number
}

/**
 * It transforms rgb -> rgba (we add an alpha channel)
 * Returns a new array rgba: Uint8ClampedArray
 *
 * @param rgb - The rgb array
 * @param width
 * @param height
 * @returns A new rgb array with alpha channel
 */
export const rgbToRgba = (
    rgb: Uint8Array,
    width: number,
    height: number,
): Uint8ClampedArray<ArrayBuffer> => {
    const pixels = width * height;
    const rgba = new Uint8ClampedArray(pixels * 4)

    for(let i = 0; i < pixels; i++) {
        rgba[i * 4 + 0] = rgb[i*3 + 0];
        rgba[i * 4 + 1] = rgb[i*3 + 1];
        rgba[i * 4 + 2] = rgb[i*3 + 2];
        rgba[i * 4 + 3] = 255;
    }

    return rgba;

}