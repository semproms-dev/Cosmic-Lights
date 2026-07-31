import { describe, expect, it } from 'vitest';
import { handlePosition, hueSatFromPointer } from './colorWheelMath';

/** Radius of the 76px wheel the panel shows. */
const RADIUS = 38;

describe('handlePosition', () => {
  it('puts an untinted wheel in the middle', () => {
    expect(handlePosition(0, 0, RADIUS)).toEqual({ x: RADIUS, y: RADIUS });
  });

  it('sends hue 0 to the right and hue 90 down, matching the painted gradient', () => {
    // The conic gradient is rotated by `from 90deg` for exactly this reason: the
    // angle is measured from 3 o'clock, clockwise. Without that rotation the
    // colour under the handle is a quarter turn off the colour reported.
    const right = handlePosition(0, 100, RADIUS);
    expect(right.x).toBeCloseTo(76);
    expect(right.y).toBeCloseTo(38);

    const down = handlePosition(90, 100, RADIUS);
    expect(down.x).toBeCloseTo(38);
    expect(down.y).toBeCloseTo(76);
  });

  it('places half-saturation halfway out', () => {
    expect(handlePosition(0, 50, RADIUS).x).toBeCloseTo(57);
  });
});

describe('hueSatFromPointer', () => {
  it('reads the hue from the angle and the saturation from the distance', () => {
    expect(hueSatFromPointer(RADIUS, 0, RADIUS)).toEqual({ hue: 0, saturation: 100 });
    expect(hueSatFromPointer(0, RADIUS, RADIUS)).toEqual({ hue: 90, saturation: 100 });
  });

  it('leaves the zone untinted at the centre', () => {
    expect(hueSatFromPointer(0, 0, RADIUS).saturation).toBe(0);
  });

  it('reports angles above the x axis as their positive turn', () => {
    // `Math.atan2` returns -90° for straight up; a hue has to be 0..360 or the
    // stored value would not round-trip through the handle position.
    expect(hueSatFromPointer(0, -RADIUS, RADIUS).hue).toBe(270);
  });

  it('clamps the saturation past the rim instead of freezing the hue', () => {
    // Mid-drag the hand routinely leaves a 76px circle and expects the tint to
    // go on turning at full strength.
    expect(hueSatFromPointer(0, 300, RADIUS)).toEqual({ hue: 90, saturation: 100 });
  });

  it('round-trips through the handle position', () => {
    const { x, y } = handlePosition(210, 40, RADIUS);
    expect(hueSatFromPointer(x - RADIUS, y - RADIUS, RADIUS)).toEqual({ hue: 210, saturation: 40 });
  });
});
