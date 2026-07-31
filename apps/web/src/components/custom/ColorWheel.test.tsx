import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../test/render';
import { ColorWheel } from './ColorWheel';

/**
 * The wheel is 76px across and jsdom lays everything out at (0, 0), so its
 * centre sits at (38, 38) and its rim 38px away. Pointer positions below are
 * written in those terms.
 */
const SIZE = 76;
const CENTRE = SIZE / 2;

/**
 * Pointer events are dispatched as `MouseEvent`s: jsdom does not implement
 * `PointerEvent`, and a plain `Event` would carry no `clientX`/`clientY` — which
 * is the entire input of the maths under test.
 */
const pointerAt = (type: string, clientX: number, clientY: number) =>
  new MouseEvent(type, { clientX, clientY, bubbles: true });

const renderWheel = (props: Partial<Parameters<typeof ColorWheel>[0]> = {}) => {
  const onChange = vi.fn();
  const onChangeEnd = vi.fn();
  render(
    <ColorWheel
      label="Shadows"
      hue={0}
      saturation={0}
      size={SIZE}
      onChange={onChange}
      onChangeEnd={onChangeEnd}
      {...props}
    />,
  );
  return { onChange, onChangeEnd, wheel: screen.getByRole('group', { name: 'Shadows' }) };
};

describe('ColorWheel', () => {
  it('shows its label and current colour', () => {
    renderWheel({ hue: 210, saturation: 20 });

    expect(screen.getByText('Shadows')).toBeInTheDocument();
    expect(screen.getByText('210° · 20')).toBeInTheDocument();
  });

  it('reads the hue from the angle and the saturation from the distance', () => {
    const { onChange, wheel } = renderWheel();

    fireEvent(wheel, pointerAt('pointerdown', SIZE, CENTRE));

    expect(onChange).toHaveBeenCalledWith(0, 100);
  });

  it('leaves the zone untinted when the centre is picked', () => {
    const { onChange, wheel } = renderWheel({ hue: 120, saturation: 80 });

    fireEvent(wheel, pointerAt('pointerdown', CENTRE, CENTRE));

    expect(onChange).toHaveBeenCalledWith(0, 0);
  });

  it('keeps following the hue when the drag leaves the wheel', () => {
    // Past the rim the saturation clamps instead of freezing: the hand goes on
    // circling well outside a 76px disc and expects the tint to keep turning.
    const { onChange, onChangeEnd, wheel } = renderWheel();

    fireEvent(wheel, pointerAt('pointerdown', SIZE, CENTRE));
    fireEvent(window, pointerAt('pointermove', CENTRE, CENTRE + 300));

    expect(onChange).toHaveBeenLastCalledWith(90, 100);
    // Still mid-gesture: nothing has been checkpointed yet.
    expect(onChangeEnd).not.toHaveBeenCalled();

    fireEvent(window, pointerAt('pointerup', CENTRE, CENTRE + 300));
    expect(onChangeEnd).toHaveBeenCalledTimes(1);
  });

  it('stops tracking the pointer once the drag is over', () => {
    const { onChange, wheel } = renderWheel();

    fireEvent(wheel, pointerAt('pointerdown', SIZE, CENTRE));
    fireEvent(window, pointerAt('pointerup', SIZE, CENTRE));
    onChange.mockClear();
    fireEvent(window, pointerAt('pointermove', CENTRE, SIZE));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('walks the hue and the saturation with the arrow keys', () => {
    const { onChange, onChangeEnd, wheel } = renderWheel({ hue: 10, saturation: 50 });

    fireEvent.keyDown(wheel, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(15, 50);

    fireEvent.keyDown(wheel, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(10, 55);

    // A key press is a finished edit, so each one is its own undo step.
    expect(onChangeEnd).toHaveBeenCalledTimes(2);
  });

  it('wraps the hue round the rim and stops the saturation at the centre', () => {
    const { onChange, wheel } = renderWheel({ hue: 2, saturation: 2 });

    fireEvent.keyDown(wheel, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(357, 2);

    fireEvent.keyDown(wheel, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(2, 0);
  });

  it('ignores keys it does not use', () => {
    const { onChange, wheel } = renderWheel();

    fireEvent.keyDown(wheel, { key: 'Enter' });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers Reset on the label and calls it', () => {
    const onReset = vi.fn();
    renderWheel({ onReset });

    // The hover listener is on the label element, not on the text span inside
    // it, and `mouseenter` does not bubble.
    const label = screen.getByText('Shadows').parentElement as HTMLElement;
    fireEvent.mouseEnter(label);
    fireEvent.click(label);

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('keeps the label box the same size while it offers Reset', () => {
    // The flicker this prevents: swapping the text outright made the label
    // shrink into the shorter "Reset", which pulled the box out from under the
    // pointer — hover off, long label back, hover on, and round it went. Both
    // texts stay in one grid cell and only their visibility changes, so the box
    // is always as wide as the wider of the two.
    renderWheel({ onReset: vi.fn() });
    const label = screen.getByText('Shadows').parentElement as HTMLElement;

    fireEvent.mouseEnter(label);

    expect(screen.getByText('Reset')).toBeVisible();
    expect(screen.getByText('Shadows')).toBeInTheDocument();
    expect(screen.getByText('Shadows')).not.toBeVisible();

    fireEvent.mouseLeave(label);

    expect(screen.getByText('Shadows')).toBeVisible();
    expect(screen.getByText('Reset')).not.toBeVisible();
  });

  it('takes no input at all while disabled', () => {
    const onReset = vi.fn();
    const { onChange, wheel } = renderWheel({ disabled: true, onReset });

    fireEvent(wheel, pointerAt('pointerdown', SIZE, CENTRE));
    fireEvent.keyDown(wheel, { key: 'ArrowRight' });
    fireEvent.click(screen.getByText('Shadows'));

    expect(onChange).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    // Out of the tab order too, so it cannot be focused into a dead end.
    expect(wheel).toHaveAttribute('tabindex', '-1');
  });
});
