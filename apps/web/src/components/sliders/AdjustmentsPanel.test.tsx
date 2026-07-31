import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../../test/render';
import { AdjustmentsPanel } from './elements/AdjustmentsPanel';

/**
 * Only the `basic` section is expanded on mount, and a collapsed Mantine panel
 * stays out of the accessibility tree — clicking it open does not help either,
 * because its `Collapse` needs real layout that jsdom does not provide. So the
 * sections below are queried with `hidden: true`. That is fine for what these
 * tests assert (which group a slider is in, and where it rests); it does mean
 * they would not catch a section that never opens.
 */
const INCLUDING_COLLAPSED = { hidden: true } as const;

describe('AdjustmentsPanel', () => {
  it('renders the Basic section with its sliders', () => {
    render(<AdjustmentsPanel />);

    expect(screen.getByRole('button', { name: 'Basic' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Exposure' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Contrast' })).toBeInTheDocument();
  });

  it('shows each slider at its default value', () => {
    render(<AdjustmentsPanel />);

    const exposure = screen.getByRole('slider', { name: 'Exposure' });
    expect(exposure).toHaveAttribute('aria-valuenow', '0');
  });

  it('puts the three grading wheels in the Color section', () => {
    render(<AdjustmentsPanel />);

    // Side by side rather than stacked — what the shadows are tinted towards
    // only means something next to where the highlights went. What each wheel
    // writes is covered in GradingWheels.test.tsx.
    expect(screen.getByText('Grading', INCLUDING_COLLAPSED)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Midtones', ...INCLUDING_COLLAPSED })).toBeInTheDocument();
    expect(screen.getAllByText('0° · 0', INCLUDING_COLLAPSED)).toHaveLength(3);
  });

  it('splits Details into local contrast and noise reduction', () => {
    render(<AdjustmentsPanel />);

    // The two halves pull against each other — one adds local contrast, the
    // other removes detail — so they are shown apart rather than in one list.
    expect(screen.getByText('Local Contrast')).toBeInTheDocument();
    expect(screen.getByText('Noise Reduction')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Texture', ...INCLUDING_COLLAPSED })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Luminance', ...INCLUDING_COLLAPSED })).toBeInTheDocument();
  });

  it('rests the noise sliders where each one is neutral', () => {
    render(<AdjustmentsPanel />);

    // Detail is the shape of the luminance filter, not its amount, so it is
    // neutral at 50 — what turns the feature off is Luminance at 0.
    const at = (name: string) =>
      screen.getByRole('slider', { name, ...INCLUDING_COLLAPSED }).getAttribute('aria-valuenow');
    expect(at('Color')).toBe('0');
    expect(at('Luminance')).toBe('0');
    expect(at('Detail')).toBe('50');
  });

  it('offers Auto denoise, but only once there is an ISO to read', () => {
    // Auto asks the shot's ISO how noisy the sensor was — RAW or JPEG alike, the
    // difference between them is the dose, not the availability. With no image
    // open there is no ISO, so the button has nothing to work from. What it
    // computes from that ISO is covered in editor/noise.test.ts.
    render(<AdjustmentsPanel />);

    const auto = screen.getByRole('button', { name: 'Auto denoise', ...INCLUDING_COLLAPSED });
    // ARIA rather than the `disabled` attribute on purpose: a natively disabled
    // button emits no pointer events, and the tooltip explaining why it is
    // unavailable would never get a chance to appear.
    expect(auto).toHaveAttribute('aria-disabled', 'true');
  });

  it('does nothing when Auto denoise is clicked with no ISO to go on', () => {
    // The flip side of aria-disabled: the handler really does run, so it has to
    // refuse by itself.
    render(<AdjustmentsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Auto denoise', ...INCLUDING_COLLAPSED }));

    const at = (name: string) =>
      screen.getByRole('slider', { name, ...INCLUDING_COLLAPSED }).getAttribute('aria-valuenow');
    expect(at('Color')).toBe('0');
    expect(at('Luminance')).toBe('0');
  });
});
