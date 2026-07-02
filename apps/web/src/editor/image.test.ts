import { describe, expect, it } from "vitest";
import { rgbToRgba } from "./image";

describe("rgbToRgba", () => {
    it("interleaves an opaque alpha after every RGB triplet", () => {
        // Two pixels: (10,20,30) and (40,50,60).
        const rgb = new Uint8Array([10, 20, 30, 40, 50, 60]);

        const rgba = rgbToRgba(rgb, 2, 1);

        expect(Array.from(rgba)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    });

    it("returns a Uint8ClampedArray of length width * height * 4", () => {
        const rgb = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

        const rgba = rgbToRgba(rgb, 2, 2);

        expect(rgba).toBeInstanceOf(Uint8ClampedArray);
        expect(rgba).toHaveLength(2 * 2 * 4);
    });

    it("preserves channel order (R, G, B) for a single pixel", () => {
        const rgb = new Uint8Array([200, 100, 50]);

        const rgba = rgbToRgba(rgb, 1, 1);

        expect(rgba[0]).toBe(200); // R
        expect(rgba[1]).toBe(100); // G
        expect(rgba[2]).toBe(50); // B
        expect(rgba[3]).toBe(255); // A
    });
});
