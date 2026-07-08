import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../../test/render';
import { CropPanel } from './CropPanel';

describe('CropPanel', () => {
  it('shows Original selected by default', () => {
    render(<CropPanel />);

    expect(screen.getByRole('radio', { name: 'Original' })).toBeChecked();
  });

  it('selects a new aspect ratio when clicked', () => {
    render(<CropPanel />);

    fireEvent.click(screen.getByRole('radio', { name: '16:9' }));

    expect(screen.getByRole('radio', { name: '16:9' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Original' })).not.toBeChecked();
  });
});
