import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/render';
import { IDENTITY_GEOMETRY, type Geometry } from '../../../editor/geometry';

// A miniature store: `image` gates whether the controls are editable, and
// `geometry`/`angle` are what the sliders read back, so a write has to land in
// here before the thumb moves. That is the whole point of these tests — the
// sliders used to be `useState` and looked identical while changing nothing.
const { state } = vi.hoisted(() => ({
  state: {
    image: null as { width: number; height: number } | null,
    geometry: null as unknown as Geometry,
    angle: 0,
    setGeometry: vi.fn(),
    setRotationAngle: vi.fn(),
    commit: vi.fn(),
  },
}))

vi.mock('../../../editor/editorContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../editor/editorContext')>()
  return {
    ...actual,
    useEditor: () => state,
  }
})

import { DistortionComponent } from './DistortionComponent'

describe('DistortionComponent', () => {
  beforeEach(() => {
    state.image = null
    state.geometry = IDENTITY_GEOMETRY
    state.angle = 0
    state.setGeometry = vi.fn()
    state.setRotationAngle = vi.fn()
    state.commit = vi.fn()
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

  it('shows the value the store holds, not one of its own', () => {
    state.image = { width: 100, height: 100 };
    state.geometry = { ...IDENTITY_GEOMETRY, perspectiveV: 42 };
    state.angle = -12.5;
    render(<DistortionComponent />);

    const sliders = screen.getAllByRole('slider');
    // Order: distortion, perspectiveV, perspectiveH, scaleY, scaleX, rotate,
    // offsetX, offsetY.
    expect(sliders[1]).toHaveAttribute('aria-valuenow', '42');
    expect(sliders[5]).toHaveAttribute('aria-valuenow', '-12.5');
    expect(sliders[0]).toHaveAttribute('aria-valuenow', '0');
  });

  it('writes a moved slider to the store under its own key', () => {
    state.image = { width: 100, height: 100 };
    render(<DistortionComponent />);

    const sliders = screen.getAllByRole('slider');
    fireEvent.keyDown(sliders[0], { key: 'ArrowRight' });

    expect(state.setGeometry).toHaveBeenCalledWith('distortion', 1);
  });

  it('sends the rotate slider to the straighten angle, not to a geometry key', () => {
    state.image = { width: 100, height: 100 };
    render(<DistortionComponent />);

    // Two controls on one value would let the second one dragged silently win,
    // so Geometry's rotate must write the very same angle the Rotation section
    // does — and must not invent a geometry key of its own.
    fireEvent.keyDown(screen.getAllByRole('slider')[5], { key: 'ArrowRight' });

    expect(state.setRotationAngle).toHaveBeenCalledWith(0.1);
    expect(state.setGeometry).not.toHaveBeenCalled();
  });
});
