import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PreferencesProvider } from '../../preferences/PreferencesProvider';
import { buildInitialAdjustments } from '../../editor/editorReducer';
import { buildDefaultCurves } from '../../editor/curves';
import type { LumaHistogram } from '../../editor/histogram';
import '../../i18n';

/**
 * Tested on its own rather than through the shared `AdjustmentsPanel.test.tsx`,
 * for a reason worth writing down: that file renders the *real* editor store,
 * which starts with no image open — exactly the case where Auto is disabled.
 * Here the store is mocked so the button's two inputs (the EXIF ISO and the
 * measured noise) can be controlled independently, which is what the gating
 * rules are about.
 *
 * What the button computes from those inputs is covered in `editor/noise.test.ts`;
 * these tests check that it picks the right input and writes the sliders.
 */
const { setAdjustment, setCurve, commit, adjustments, curves, image } = vi.hoisted(() => {
  const adjustments: Record<string, number> = {};
  const curves: Record<string, { x: number; y: number }[]> = {};
  const image: {
    metadata: { iso_speed?: number } | null;
    noise: { lumaSigma: number; chromaSigma: number } | null;
    histogram: LumaHistogram | null;
    source: 'raw' | 'developed';
  } = { metadata: null, noise: null, histogram: null, source: 'raw' };
  return { setAdjustment: vi.fn(), setCurve: vi.fn(), commit: vi.fn(), adjustments, curves, image };
});

vi.mock('../../editor/editorContext', () => ({
  useEditor: () => ({ image, adjustments, curves, setAdjustment, setCurve, commit }),
}));

import { AdjustmentsPanel } from './elements/AdjustmentsPanel';

/** The Details section is collapsed on mount (see AdjustmentsPanel.test.tsx). */
const INCLUDING_COLLAPSED = { hidden: true } as const;

/** A noisy reading whose measured proposal is { colorNoise: 57, luminanceNoise: 33 }. */
const NOISY = { lumaSigma: 0.02, chromaSigma: 0.04 };

function renderPanel(): void {
  render(<AdjustmentsPanel />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MantineProvider defaultColorScheme="dark">
        <PreferencesProvider>{children}</PreferencesProvider>
      </MantineProvider>
    ),
  });
}

const autoButton = () => screen.getByRole('button', { name: 'Auto reduction', ...INCLUDING_COLLAPSED });

/**
 * A well-exposed frame, from the worked example in `autoAdjust.test.ts`: the
 * six tone sliders land at { exposure: 0, contrast: -7, highlights: 15,
 * shadows: 0, whites: 0, blacks: 0 }.
 */
const WELL_EXPOSED: LumaHistogram = {
  bins: [],
  total: 0,
  p0_1: 0.02,
  p10: 0.25,
  p50: 0.5,
  p90: 0.75,
  p99_9: 0.98,
};

const autoAdjustButton = () => screen.getByRole('button', { name: 'Auto adjust' });

describe('AdjustmentsPanel Auto denoise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(adjustments, buildInitialAdjustments());
    Object.assign(curves, buildDefaultCurves());
    image.metadata = null;
    image.noise = null;
    image.histogram = null;
    image.source = 'raw';
  });

  it('stays disabled when an open image has neither an ISO nor a measurement', () => {
    // A JPEG with no EXIF that was too small to measure, say: the button has
    // nothing to work from even though an image is open.
    renderPanel();

    expect(autoButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('enables on an ISO alone, without any measurement', () => {
    // The measurement is an optional extra input, not a requirement: the button
    // must keep working on the ISO curve when the pixels could not be read.
    image.metadata = { iso_speed: 3200 };

    renderPanel();

    expect(autoButton()).toHaveAttribute('aria-disabled', 'false');
  });

  it('enables on a measurement alone, without any ISO', () => {
    // A developed file whose EXIF was stripped still knows how noisy it is — the
    // whole reason the load-time measurement exists.
    image.noise = NOISY;
    image.source = 'developed';

    renderPanel();

    expect(autoButton()).toHaveAttribute('aria-disabled', 'false');
  });

  it('writes the ISO curve when only the ISO is available', () => {
    // ISO 3200, no measurement: the plain ISO mapping decides the dose.
    image.metadata = { iso_speed: 3200 };

    renderPanel();
    fireEvent.click(autoButton());

    expect(setAdjustment).toHaveBeenCalledWith('colorNoise', 65);
    expect(setAdjustment).toHaveBeenCalledWith('luminanceNoise', 39);
    expect(setAdjustment).toHaveBeenCalledWith('luminanceDetail', 0);
  });

  it('writes the measured noise when only a measurement is available', () => {
    // No ISO means the prior is silent; the measurement shapes the proposal.
    image.noise = NOISY;
    image.source = 'developed';

    renderPanel();
    fireEvent.click(autoButton());

    expect(setAdjustment).toHaveBeenCalledWith('colorNoise', 31);
    expect(setAdjustment).toHaveBeenCalledWith('luminanceNoise', 17);
  });

  it('prefers the measurement once there is one', () => {
    // ISO 800 (full trust) with a measurement: the measured proposal wins over
    // what the blind ISO curve alone would have written.
    image.metadata = { iso_speed: 800 };
    image.noise = NOISY;

    renderPanel();
    fireEvent.click(autoButton());

    expect(setAdjustment).toHaveBeenCalledWith('colorNoise', 57);
    expect(setAdjustment).toHaveBeenCalledWith('luminanceNoise', 33);
  });

  it('lands the three writes as a single undo step', () => {
    image.noise = NOISY;

    renderPanel();
    fireEvent.click(autoButton());

    expect(setAdjustment).toHaveBeenCalledTimes(3);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('AdjustmentsPanel Auto adjust (tone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(adjustments, buildInitialAdjustments());
    Object.assign(curves, buildDefaultCurves());
    image.metadata = null;
    image.noise = null;
    image.histogram = null;
    image.source = 'raw';
  });

  it('stays disabled while the open image has no measured histogram', () => {
    // The histogram is measured at load and stored on the image; without it the
    // button has nothing to map. What it maps is covered in
    // editor/autoAdjust.test.ts.
    renderPanel();

    expect(autoAdjustButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('enables once the image carries a histogram', () => {
    image.histogram = WELL_EXPOSED;

    renderPanel();

    expect(autoAdjustButton()).toHaveAttribute('aria-disabled', 'false');
  });

  it('writes the six tone sliders from the histogram', () => {
    image.histogram = WELL_EXPOSED;

    renderPanel();
    fireEvent.click(autoAdjustButton());

    expect(setAdjustment).toHaveBeenCalledWith('exposure', 0);
    expect(setAdjustment).toHaveBeenCalledWith('contrast', -7);
    expect(setAdjustment).toHaveBeenCalledWith('highlights', 15);
    expect(setAdjustment).toHaveBeenCalledWith('shadows', 0);
    expect(setAdjustment).toHaveBeenCalledWith('whites', 0);
    expect(setAdjustment).toHaveBeenCalledWith('blacks', 0);
  });

  it('lands the six writes as a single undo step', () => {
    image.histogram = WELL_EXPOSED;

    renderPanel();
    fireEvent.click(autoAdjustButton());

    expect(setAdjustment).toHaveBeenCalledTimes(6);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('refuses to act when no histogram is available', () => {
    // The flip side of aria-disabled: the handler really does run, so it has to
    // refuse by itself.
    renderPanel();

    fireEvent.click(autoAdjustButton());

    expect(setAdjustment).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
