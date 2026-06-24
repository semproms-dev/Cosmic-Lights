import { describe, expect, it } from 'vitest';
import { render, screen } from '../../test/render';
import { AdjustmentsPanel } from './elements/AdjustmentsPanel';

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
});
