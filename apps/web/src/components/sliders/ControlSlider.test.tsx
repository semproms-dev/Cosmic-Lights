import { describe, expect, it, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PreferencesProvider } from '../../preferences/PreferencesProvider';
import '../../i18n';

/**
 * The store is mocked because the numeric input is disabled while no image is
 * open, and the real provider starts with none. `image` is all this component
 * asks the editor for.
 */
const { store } = vi.hoisted(() => ({
  store: { image: { width: 100, height: 100 } as { width: number; height: number } | null },
}));

vi.mock('../../editor/editorContext', () => ({
  useEditor: () => ({ image: store.image }),
}));

import { ControlSlider } from './elements/ControlSlider';

interface Handlers {
  onChange?: () => void;
  onChangeEnd?: () => void;
}

function renderSlider(label = 'Exposure', { onChange, onChangeEnd }: Handlers = {}) {
  return render(
    <ControlSlider
      label={label}
      value={0}
      min={-5}
      max={5}
      step={0.01}
      onChange={onChange ?? vi.fn()}
      onChangeEnd={onChangeEnd}
    />,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        // Preferences too: the row asks them whether to show the helper tooltip.
        <MantineProvider defaultColorScheme="dark">
          <PreferencesProvider>{children}</PreferencesProvider>
        </MantineProvider>
      ),
    },
  );
}

/**
 * Opens the typed-value input by clicking the value readout, the way the user
 * does. Returns the input, so a test that needs it does not query twice.
 */
function openInput(label = 'Exposure'): HTMLElement {
  fireEvent.click(screen.getByRole('spinbutton', { name: label }));
  return screen.getByRole('textbox', { name: label });
}

describe('ControlSlider — Escape closes the numeric input', () => {
  it('closes it when Escape arrives with the focus still inside', () => {
    renderSlider();
    const input = openInput();
    fireEvent.focus(input);

    // Dispatched on the input rather than on `window`: that is the path the key
    // really takes, and it has to reach the window listener by bubbling.
    fireEvent.keyDown(input, { key: 'Escape' });

    // Back to the readout: the input is gone, not merely blurred.
    expect(screen.queryByRole('textbox', { name: 'Exposure' })).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Exposure' })).toBeInTheDocument();
  });

  it('closes it when Escape arrives with the focus somewhere else entirely', () => {
    // The reason the listener sits on `window` at all. Blurring the input
    // commits, but leaves it open, so before this the row could be left with a
    // stray input open and no keyboard way to dismiss it.
    renderSlider();
    const input = openInput();
    fireEvent.blur(input);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: 'Exposure' })).not.toBeInTheDocument();
  });

  it('discards the typed text instead of committing it', () => {
    // Typing drives the preview live (`onChange` on every keystroke), so what
    // Escape has to undo is the *checkpoint*: it must not close the gesture with
    // an undo step, and the mirror must go back to the committed value, or the
    // abandoned text would greet the user next time the input opens.
    const onChangeEnd = vi.fn();
    renderSlider('Exposure', { onChangeEnd });
    const input = openInput();

    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onChangeEnd).not.toHaveBeenCalled();
    expect(openInput()).toHaveValue('0');
  });

  it('leaves the input open for any other key', () => {
    renderSlider();
    openInput();

    fireEvent.keyDown(window, { key: 'a' });

    expect(screen.getByRole('textbox', { name: 'Exposure' })).toBeInTheDocument();
  });

  it('closes every open row at once', () => {
    // Each row keeps its own `input` flag, so several can be open together and
    // one Escape dismisses them all. Deliberate: Escape means "never mind",
    // and picking a single row to close would be picking one arbitrarily.
    render(
      <>
        <ControlSlider label="Exposure" value={0} min={-5} max={5} step={0.01} onChange={vi.fn()} />
        <ControlSlider label="Contrast" value={0} min={-5} max={5} step={0.01} onChange={vi.fn()} />
      </>,
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <MantineProvider defaultColorScheme="dark">
            <PreferencesProvider>{children}</PreferencesProvider>
          </MantineProvider>
        ),
      },
    );
    openInput('Exposure');
    openInput('Contrast');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: 'Exposure' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Contrast' })).not.toBeInTheDocument();
  });
});
