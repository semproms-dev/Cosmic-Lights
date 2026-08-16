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

    // All three rest at 0. Detail is the shape of the luminance filter rather
    // than its amount — what turns the feature off is Luminance at 0 — but its
    // neutral is still 0, because it mixes back toward the ORIGINAL luminance:
    // any non-zero value hands that fraction of the NOISE back and caps the
    // denoiser accordingly. See the note in editor/adjustments.ts.
    const at = (name: string) =>
      screen.getByRole('slider', { name, ...INCLUDING_COLLAPSED }).getAttribute('aria-valuenow');
    expect(at('Color')).toBe('0');
    expect(at('Luminance')).toBe('0');
    expect(at('Detail')).toBe('0');
  });

  it('offers Auto denoise, but only once there is an ISO to read', () => {
    // Auto asks the shot's ISO how noisy the sensor was — RAW or JPEG alike, the
    // difference between them is the dose, not the availability. With no image
    // open there is no ISO, so the button has nothing to work from. What it
    // computes from that ISO is covered in editor/noise.test.ts.
    render(<AdjustmentsPanel />);

    const auto = screen.getByRole('button', { name: 'Auto reduction', ...INCLUDING_COLLAPSED });
    // ARIA rather than the `disabled` attribute on purpose: a natively disabled
    // button emits no pointer events, and the tooltip explaining why it is
    // unavailable would never get a chance to appear.
    expect(auto).toHaveAttribute('aria-disabled', 'true');
  });

  it('does nothing when Auto denoise is clicked with no ISO to go on', () => {
    // The flip side of aria-disabled: the handler really does run, so it has to
    // refuse by itself.
    render(<AdjustmentsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Auto reduction', ...INCLUDING_COLLAPSED }));

    const at = (name: string) =>
      screen.getByRole('slider', { name, ...INCLUDING_COLLAPSED }).getAttribute('aria-valuenow');
    expect(at('Color')).toBe('0');
    expect(at('Luminance')).toBe('0');
  });

  it('offers Auto adjust, but only once there is an image to analyse', () => {
    // Auto adjust reasons about the luma histogram measured at load time; with
    // no image open there is none, so the button has nothing to work from. What
    // it maps is covered in editor/autoAdjust.test.ts.
    render(<AdjustmentsPanel />);

    const auto = screen.getByRole('button', { name: 'Auto adjust' });
    expect(auto).toHaveAttribute('aria-disabled', 'true');
  });

  it('does nothing when Auto adjust is clicked with no image open', () => {
    render(<AdjustmentsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Auto adjust' }));

    const exposure = screen.getByRole('slider', { name: 'Exposure' });
    expect(exposure).toHaveAttribute('aria-valuenow', '0');
  });

  it('offers the classic templates, locked with no image open', () => {
    // There is no image open in the real-store test, so the group is disabled —
    // there is nothing to apply a template to yet. What the radios do once an
    // image IS open (switching, turning the current one off) is covered in
    // AdjustmentsPanelTemplates.test.tsx, which mocks the store with an image.
    render(<AdjustmentsPanel />);

    const bw = screen.getByRole('radio', { name: 'Black and White', ...INCLUDING_COLLAPSED });
    const sepia = screen.getByRole('radio', { name: 'Sepia', ...INCLUDING_COLLAPSED });
    expect(bw).not.toBeChecked();
    expect(sepia).not.toBeChecked();
    expect(bw).toBeDisabled();
    expect(sepia).toBeDisabled();
  });
});
