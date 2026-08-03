import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '../../../test/render';
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

  it('renders the orientation, rotation and geometry tool sections', () => {
    render(<CropPanel />);

    expect(screen.getByText('Orientation')).toBeInTheDocument();
    expect(screen.getByText('Rotation')).toBeInTheDocument();
    expect(screen.getByText('Geometry')).toBeInTheDocument();
    expect(screen.getByText('Distortion')).toBeInTheDocument();
    expect(screen.getByText('Perspective')).toBeInTheDocument();
    expect(screen.getByText('Transform')).toBeInTheDocument();
    expect(screen.getByText('Offset')).toBeInTheDocument();
  });
});
