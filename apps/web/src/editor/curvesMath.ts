import { clamp } from "../utils";
import type { CurvePoint } from "./curves";

/**
 * Builds a monotone cubic interpolator (Fritsch–Carlson) over the given points.
 *
 * The points must be sorted ascending by `x` with distinct `x` values
 * (guaranteed upstream by `clampToNeighbors`) and contain at least two entries.
 * Precomputes the per-segment slopes and per-node tangents once, then returns an
 * evaluator `(x) => y` so callers (e.g. `compileLut`) build it a single time and
 * sample it cheaply.
 *
 * @param points - Curve control points, ascending by `x`.
 * @returns A function mapping an input `x` to the interpolated `y`.
 */
export const interpolateMonotone = (points: CurvePoint[]): ((x: number) => number) => {
    const n = points.length;
    const dx: number[] = [];
    const delta: number[] = [];

    for (let i = 0; i < n - 1; i++) {
        dx[i] = points[i + 1].x - points[i].x;
        delta[i] = (points[i + 1].y - points[i].y) / dx[i];
    }

    // Tangents at each node.
    const m: number[] = [];
    m[0] = delta[0];
    m[n - 1] = delta[n - 2];

    for (let i = 1; i < n - 1; i++) {
        if (Math.sign(delta[i - 1]) !== Math.sign(delta[i]) || delta[i - 1] === 0 || delta[i] === 0) {
            // Local extremum -> flat tangent (keeps the curve monotone).
            m[i] = 0;
        } else {
            m[i] = (delta[i - 1] + delta[i]) / 2;
        }
    }

    // Limit tangents so segments never overshoot (Fritsch–Carlson condition).
    for (let i = 0; i < n - 1; i++) {
        if (delta[i] === 0) {
            m[i] = 0;
            m[i + 1] = 0;
        } else {
            const a = m[i] / delta[i];
            const b = m[i + 1] / delta[i];
            const t = a * a + b * b;
            if (t > 9) {
                const s = 3 / Math.sqrt(t);
                m[i] = s * a * delta[i];
                m[i + 1] = s * b * delta[i];
            }
        }
    }

    return (x: number): number => {
        const clampedX = clamp(x, points[0].x, points[n - 1].x);

        // Find the segment [i, i+1] that contains clampedX.
        let i = 0;
        while (i < n - 2 && clampedX > points[i + 1].x) {
            i++;
        }

        const h = dx[i];
        const t = (clampedX - points[i].x) / h;
        const t2 = t * t;
        const t3 = t2 * t;

        // Cubic Hermite basis functions.
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        return h00 * points[i].y + h10 * h * m[i] + h01 * points[i + 1].y + h11 * h * m[i + 1];
    };
};

/**
 * Samples a monotone curve into a 256-entry lookup table.
 *
 * The LUT is the contract with the image pipeline: index = input value,
 * entry = output value, both integers in 0..255.
 *
 * @param points - Curve control points, ascending by `x`.
 * @returns A 256-length array of integers in 0..255.
 */
export const compileLut = (points: CurvePoint[]): number[] => {
    const compiledPoints = interpolateMonotone(points);
    const lut: number[] = [];

    for(let i = 0; i < 256; i++) {
        lut[i] = Math.round(clamp(compiledPoints(i), 0, 255));
    }
    return lut;

}

/**
 * Returns a new array of points sorted ascending by `x`.
 *
 * Pure: the input array is never mutated (the reducer relies on this).
 *
 * @param points - Curve control points in any order.
 * @returns A new, ascending-by-`x` array.
 */
export const sortByX = (points: CurvePoint[]): CurvePoint[] =>
    [...points].sort((a, b) => a.x - b.x);

/**
 * Inserts a point, keeping the array sorted by `x`.
 *
 * A point whose `x` already exists is ignored (duplicate `x` would produce a
 * zero-width segment, i.e. `dx == 0`, in the interpolator).
 *
 * @param points - Existing control points, ascending by `x`.
 * @param point - The point to insert.
 * @returns A new sorted array, or the original array if `x` already exists.
 */
export const insertPoint = (points: CurvePoint[], point: CurvePoint): CurvePoint[] => {
    if (points.some((existing) => existing.x === point.x)) {
        return points;
    }
    return sortByX([...points, point]);
};

/**
 * Removes the point at `index`, unless it is an endpoint.
 *
 * The first and last points are anchors (x = 0 / x = 255) and cannot be
 * removed, so those calls return the array unchanged.
 *
 * @param points - Existing control points, ascending by `x`.
 * @param index - Index of the point to remove.
 * @returns A new array without that point, or the original if it is an endpoint.
 */
export const removePoint = (points: CurvePoint[], index: number): CurvePoint[] => {
    if (index <= 0 || index >= points.length - 1) {
        return points;
    }
    return points.filter((_, i) => i !== index);
};

/**
 * Repositions the point at `index`, clamping it to stay valid.
 *
 * Endpoints keep their `x` anchored (first → 0, last → 255) and may only move
 * in `y`. Interior points are clamped between their neighbours with a 1px gap
 * so no two points share an `x`. `y` is always clamped to 0..255.
 *
 * @param points - Existing control points, ascending by `x`.
 * @param index - Index of the point being moved.
 * @param point - The desired new position.
 * @returns A new array with the point at `index` replaced.
 */
export const clampToNeighbors = (
    points: CurvePoint[],
    index: number,
    point: CurvePoint,
): CurvePoint[] => {
    const last = points.length - 1;

    let newX: number;
    if (index === 0) {
        newX = 0;
    } else if (index === last) {
        newX = 255;
    } else {
        newX = clamp(point.x, points[index - 1].x + 1, points[index + 1].x - 1);
    }
    const newY = clamp(point.y, 0, 255);

    return points.map((existing, i) => (i === index ? { x: newX, y: newY } : existing));
};

/**
 * Maps a 0–255 curve value to an SVG x coordinate (no flip).
 *
 * @param value - Curve value in 0..255.
 * @param size - Editor width in pixels.
 * @returns The x pixel coordinate.
 */
export const valueToSvgX = (value: number, size: number): number => (value / 255) * size;

/**
 * Maps an SVG x coordinate back to a 0–255 curve value, clamped to range.
 *
 * @param coord - The x pixel coordinate (may fall outside the canvas).
 * @param size - Editor width in pixels.
 * @returns The curve value in 0..255.
 */
export const svgToValueX = (coord: number, size: number): number =>
    clamp((coord / size) * 255, 0, 255);

/**
 * Maps a 0–255 curve value to an SVG y coordinate (Y is flipped: 255 at the top).
 *
 * @param value - Curve value in 0..255.
 * @param size - Editor height in pixels.
 * @returns The y pixel coordinate.
 */
export const valueToSvgY = (value: number, size: number): number => size - (value / 255) * size;

/**
 * Maps an SVG y coordinate back to a 0–255 curve value (Y is flipped), clamped to range.
 *
 * @param coord - The y pixel coordinate (may fall outside the canvas).
 * @param size - Editor height in pixels.
 * @returns The curve value in 0..255.
 */
export const svgToValueY = (coord: number, size: number): number =>
    clamp(255 - (coord / size) * 255, 0, 255);
