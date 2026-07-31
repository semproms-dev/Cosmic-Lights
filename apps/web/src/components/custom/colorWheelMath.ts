/**
 * Polar maths of the colour wheel, in its own module so the component file only
 * exports a component (and so both directions can be unit-tested without a DOM).
 *
 * One convention holds both functions together: **angle 0 is at 3 o'clock and
 * grows clockwise**, which is what `Math.atan2` gives on a screen whose y axis
 * points down. The conic gradient that paints the wheel is rotated to match
 * (`from 90deg` in the stylesheet); drop that rotation and the colour under the
 * handle stops being the colour the wheel reports.
 */

/**
 * Places the handle inside the wheel for a given colour.
 *
 * @param hue - Hue in degrees, 0..360.
 * @param saturation - Saturation, 0..100. 0 sits at the centre.
 * @param radius - Half the wheel's diameter, in px.
 * @returns Offset from the wheel's top-left corner, in px.
 */
export function handlePosition(
  hue: number,
  saturation: number,
  radius: number,
): { x: number; y: number } {
  const angle = (hue * Math.PI) / 180;
  const distance = (saturation / 100) * radius;
  return {
    x: radius + distance * Math.cos(angle),
    y: radius + distance * Math.sin(angle),
  };
}

/**
 * Reads a colour off a pointer's offset from the wheel's centre.
 *
 * Saturation is clamped rather than ignored past the rim: while dragging, the
 * hand routinely leaves the circle and expects the hue to go on turning at full
 * strength instead of freezing.
 *
 * @param dx - Horizontal distance from the centre, in px.
 * @param dy - Vertical distance from the centre, in px (positive downwards).
 * @param radius - Half the wheel's diameter, in px.
 * @returns Whole-number hue (0..359) and saturation (0..100).
 */
export function hueSatFromPointer(
  dx: number,
  dy: number,
  radius: number,
): { hue: number; saturation: number } {
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle < 0) angle += 360;

  const distance = Math.sqrt(dx * dx + dy * dy);

  return {
    hue: Math.round(angle) % 360,
    saturation: Math.min(100, Math.round((distance / radius) * 100)),
  };
}
