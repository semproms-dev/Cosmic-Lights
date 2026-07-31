import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PreferencesProvider } from '../../preferences/PreferencesProvider';
import '../../i18n';

/**
 * Tested on its own rather than through the whole `AdjustmentsPanel`, for a
 * reason worth writing down: inside a *collapsed* Mantine accordion the children
 * are in the DOM but React attaches no refs and runs no effects for them, so a
 * wheel queried there could never read its own position and every drag would
 * look like a no-op. `AdjustmentsPanel.test.tsx` checks the panel puts the
 * wheels in the Color section; this file checks what they write.
 *
 * The store is mocked because the wheels are disabled while no image is open,
 * and the real provider starts with none.
 */
const { setAdjustment, commit, adjustments, store } = vi.hoisted(() => ({
  setAdjustment: vi.fn(),
  commit: vi.fn(),
  adjustments: {} as Record<string, number>,
  store: { image: { width: 100, height: 100 } as { width: number; height: number } | null },
}));

vi.mock('../../editor/editorContext', () => ({
  useEditor: () => ({
    image: store.image,
    adjustments,
    setAdjustment,
    commit,
  }),
}));

import { GradingWheels } from './elements/GradingWheels';
import { buildGradingDefaults } from '../../editor/adjustments';

/**
 * The wheel is 76px across and jsdom lays everything out at (0, 0), so its
 * centre sits at (38, 38) and its rim 38px away.
 */
const CENTRE = 38;
const RIM = 76;

/** jsdom implements no `PointerEvent`, and a plain `Event` carries no coordinates. */
const pointerAt = (type: string, clientX: number, clientY: number) =>
  new MouseEvent(type, { clientX, clientY, bubbles: true });

function renderWheels(): void {
  render(<GradingWheels />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      // Preferences too: the luminance rows are `ControlSlider`s, which ask the
      // preferences for whether to show the helper tooltips.
      <MantineProvider defaultColorScheme="dark">
        <PreferencesProvider>{children}</PreferencesProvider>
      </MantineProvider>
    ),
  });
}

const wheel = (name: string) => screen.getByRole('group', { name });

/**
 * The label element behind a piece of label text.
 *
 * The label holds two spans — its own text and "Reset" — and the hover listener
 * sits on their parent, which is what keeps the box from resizing mid-hover.
 * `mouseenter` does not bubble, so the parent is what the test has to hover.
 */
const labelOf = (text: string) => screen.getByText(text).parentElement as HTMLElement;

describe('GradingWheels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(adjustments, buildGradingDefaults());
    store.image = { width: 100, height: 100 };
  });

  it('offers one wheel per tonal zone', () => {
    renderWheels();

    expect(wheel('Shadows')).toBeInTheDocument();
    expect(wheel('Midtones')).toBeInTheDocument();
    expect(wheel('Highlights')).toBeInTheDocument();
  });

  it('starts every zone untinted', () => {
    renderWheels();

    // Saturation 0 is what turns a zone off; the hue behind it is irrelevant
    // until then, but it still has to be a finite number.
    expect(screen.getAllByText('0° · 0')).toHaveLength(3);
  });

  it("writes a zone's hue and saturation under its own keys", () => {
    renderWheels();

    fireEvent(wheel('Shadows'), pointerAt('pointerdown', RIM, CENTRE));

    // Two scalars, not a colour object: this is what lands in the presets, the
    // undo history and the export.
    expect(setAdjustment).toHaveBeenCalledWith('gradeShadowHue', 0);
    expect(setAdjustment).toHaveBeenCalledWith('gradeShadowSat', 100);
    // Basic's own Shadows slider must not move with it — they share one flat map.
    expect(setAdjustment).not.toHaveBeenCalledWith('shadows', expect.anything());
  });

  it('keeps the three zones apart', () => {
    renderWheels();

    fireEvent(wheel('Highlights'), pointerAt('pointerdown', CENTRE, RIM));

    expect(setAdjustment).toHaveBeenCalledWith('gradeHighHue', 90);
    expect(setAdjustment).toHaveBeenCalledWith('gradeHighSat', 100);
    expect(setAdjustment).not.toHaveBeenCalledWith('gradeShadowHue', expect.anything());
  });

  it('checkpoints the drag once, when it ends', () => {
    renderWheels();

    fireEvent(wheel('Midtones'), pointerAt('pointerdown', RIM, CENTRE));
    fireEvent(window, pointerAt('pointermove', CENTRE, RIM));
    expect(commit).not.toHaveBeenCalled();

    fireEvent(window, pointerAt('pointerup', CENTRE, RIM));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("resets all three of a zone's keys as one undo step", () => {
    renderWheels();

    fireEvent.mouseEnter(labelOf('Midtones'));
    // The zone's own text goes invisible while "Reset" shows, but both stay in
    // the box — that is the anti-flicker arrangement, tested in ColorWheel.
    expect(screen.getByText('Midtones')).not.toBeVisible();
    fireEvent.click(labelOf('Midtones'));

    // The wheel and its luminance slider are two controls to the hand but one
    // zone to the eye: a reset that left the brightness behind would be a reset
    // in name only.
    expect(setAdjustment).toHaveBeenCalledWith('gradeMidHue', 0);
    expect(setAdjustment).toHaveBeenCalledWith('gradeMidSat', 0);
    expect(setAdjustment).toHaveBeenCalledWith('gradeMidLum', 0);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('gives every zone its own luminance slider', () => {
    renderWheels();

    for (const zone of ['Shadows', 'Midtones', 'Highlights']) {
      const slider = screen.getByRole('slider', { name: `${zone} Luminance` });
      // Neutral in the middle of a symmetric range: the zone is neither
      // brightened nor darkened until it is dragged.
      expect(slider).toHaveAttribute('aria-valuenow', '0');
      expect(slider).toHaveAttribute('aria-valuemin', '-100');
      expect(slider).toHaveAttribute('aria-valuemax', '100');
    }
  });

  it("writes the luminance under the zone's own key", () => {
    renderWheels();

    // Keyboard rather than a drag: Mantine's slider reads its own layout to turn
    // a pointer position into a value, and jsdom has none to read.
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Shadows Luminance' }), {
      key: 'ArrowRight',
    });

    expect(setAdjustment).toHaveBeenCalledWith('gradeShadowLum', 1);
    // The tint is a separate control and must not move with it.
    expect(setAdjustment).not.toHaveBeenCalledWith('gradeShadowSat', expect.anything());
  });

  it('checkpoints the luminance when the drag ends, not on every step', () => {
    renderWheels();

    const slider = screen.getByRole('slider', { name: 'Highlights Luminance' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(setAdjustment).toHaveBeenCalledWith('gradeHighLum', -1);

    fireEvent.keyUp(slider, { key: 'ArrowLeft' });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("resets a zone's brightness from its own row, leaving the tint alone", () => {
    renderWheels();

    // The row's label doubles as its reset, like every other slider in the panel.
    fireEvent.mouseEnter(labelOf('Midtones Luminance'));
    expect(screen.getByText('Midtones Luminance')).not.toBeVisible();
    fireEvent.click(labelOf('Midtones Luminance'));

    expect(setAdjustment).toHaveBeenCalledWith('gradeMidLum', 0);
    expect(setAdjustment).not.toHaveBeenCalledWith('gradeMidSat', expect.anything());
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('stays out of reach while no image is open', () => {
    // Same rule as every other control in the panel: there is nothing to grade
    // yet, and a wheel that moves without changing a pixel is a lie.
    store.image = null;
    renderWheels();

    fireEvent(wheel('Shadows'), pointerAt('pointerdown', RIM, CENTRE));

    expect(setAdjustment).not.toHaveBeenCalled();
    expect(wheel('Shadows')).toHaveAttribute('aria-disabled', 'true');
  });
});
