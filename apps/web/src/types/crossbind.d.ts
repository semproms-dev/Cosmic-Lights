declare module '*.h' {
  export class TiffEncoder {
    static encodeTiff(
      rgbaPath: string,
      tiffPath: string,
      width: number,
      height: number,
      bitDepth: 8 | 16,
      metadataJson: string,
    ): Promise<void>;
  }

  export function initNative(config?: Record<string, unknown>): Promise<unknown>;
}
