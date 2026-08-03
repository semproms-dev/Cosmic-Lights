import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/render';

// Only `image` matters here: it gates whether the controls are editable.
const { state } = vi.hoisted(() => ({
  state: { image: null as { width: number; height: number } | null },
}))

vi.mock('../../../editor/editorContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../editor/editorContext')>()
  return {
    ...actual,
    useEditor: () => ({ image: state.image }),
  }
})

import { DistortionComponent } from './DistortionComponent'

describe('DistortionComponent', () => {
  beforeEach(() => {
    state.image = null
  })

  it('renders the four geometry sections', () => {
    render(<DistortionComponent />)

    expect(screen.getByText('Distortion')).toBeInTheDocument();
    expect(screen.getByText('Perspective')).toBeInTheDocument();
    expect(screen.getByText('Transform')).toBeInTheDocument();
    expect(screen.getByText('Offset')).toBeInTheDocument();
  });

  it('renders one slider per geometry control', () => {
    render(<DistortionComponent />);

    expect(screen.getAllByRole('slider')).toHaveLength(8);
  });

  it('disables the controls while no image is loaded', () => {
    render(<DistortionComponent />);

    for (const slider of screen.getAllByRole('slider')) {
      expect(slider).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('keeps each control independent once an image is loaded', () => {
    state.image = { width: 100, height: 100 };
    render(<DistortionComponent />);

    const sliders = screen.getAllByRole('slider');
    fireEvent.keyDown(sliders[0], { key: 'ArrowRight' });

    expect(sliders[0]).toHaveAttribute('aria-valuenow', '1');
    for (const slider of sliders.slice(1)) {
      expect(slider).toHaveAttribute('aria-valuenow', '0');
    }
  });
});
