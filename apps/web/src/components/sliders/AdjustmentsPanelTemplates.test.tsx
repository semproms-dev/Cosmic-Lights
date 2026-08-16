import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PreferencesProvider } from '../../preferences/PreferencesProvider';
import { buildInitialAdjustments } from '../../editor/editorReducer';
import { buildDefaultCurves } from '../../editor/curves';
import '../../i18n';

/**
 * The classic-template radios are tested on their own rather than through the
 * shared `AdjustmentsPanel.test.tsx`, for the same reason as the Auto buttons:
 * that file renders the real editor store, which starts with no image open —
 * exactly the case where the group is disabled. Here the store is mocked with
 * an image present, so the radios are live and their interaction is testable.
 *
 * The mock store is a tiny useSyncExternalStore store (one version counter plus
 * a subscription set), so writing through `setAdjustment` re-renders the panel
 * exactly as the real store does. That matters here: the radios are controlled
 * by `String(adjustments.template)` (0 = none, 1 = B&W, 2 = Sepia), every
 * change writes back through `setAdjustment` plus one `commit` — so an
 * undo/redo (Ctrl+Z) moves the radios along with the value — and a radio that
 * is re-rendered outside React's own event flow fights the controlled-input
 * restoration React performs after each click.
 */
const { store, getSnapshot, subscribe, setAdjustment, setCurve, commit } = vi.hoisted(() => {
  let version = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
  const store = {
    image: { metadata: null } as { metadata: unknown },
    adjustments: {} as Record<string, number>,
    curves: {} as Record<string, unknown>,
  };
  return {
    store,
    getSnapshot: () => version,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setAdjustment: vi.fn((key: string, value: number) => {
      store.adjustments = { ...store.adjustments, [key]: value };
      emit();
    }),
    setCurve: vi.fn(),
    commit: vi.fn(),
  };
});

vi.mock('../../editor/editorContext', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useEditor: () => {
      useSyncExternalStore(subscribe, getSnapshot);
      return {
        image: store.image,
        adjustments: store.adjustments,
        curves: store.curves,
        setAdjustment,
        setCurve,
        commit,
      };
    },
  };
});

import { AdjustmentsPanel } from './elements/AdjustmentsPanel';

/** The Color section is collapsed on mount (see AdjustmentsPanel.test.tsx). */
const INCLUDING_COLLAPSED = { hidden: true } as const;

const bwRadio = () => screen.getByRole('radio', { name: 'Black and White', ...INCLUDING_COLLAPSED });
const sepiaRadio = () => screen.getByRole('radio', { name: 'Sepia', ...INCLUDING_COLLAPSED });

function renderPanel(): void {
  render(<AdjustmentsPanel />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MantineProvider defaultColorScheme="dark">
        <PreferencesProvider>{children}</PreferencesProvider>
      </MantineProvider>
    ),
  });
}

describe('AdjustmentsPanel classic templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.adjustments = buildInitialAdjustments();
    Object.assign(store.curves, buildDefaultCurves());
    store.image.metadata = null;
  });

  it('starts with no template selected', () => {
    renderPanel();

    expect(bwRadio()).not.toBeChecked();
    expect(sepiaRadio()).not.toBeChecked();
  });

  it('selecting B&W writes template 1 and commits once', () => {
    renderPanel();

    fireEvent.click(bwRadio());

    expect(setAdjustment).toHaveBeenCalledWith('template', 1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(bwRadio()).toBeChecked();
  });

  it('selecting Sepia writes template 2 and commits once', () => {
    renderPanel();

    fireEvent.click(sepiaRadio());

    expect(setAdjustment).toHaveBeenCalledWith('template', 2);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(sepiaRadio()).toBeChecked();
  });

  it('switches templates exclusively, one selection at a time', () => {
    renderPanel();

    fireEvent.click(bwRadio());
    fireEvent.click(sepiaRadio());

    expect(sepiaRadio()).toBeChecked();
    expect(bwRadio()).not.toBeChecked();
  });

  it('turns the current template off again, leaving nothing selected', () => {
    // Unlike a plain radio group, this one may sit empty: unchecking the active
    // template is the way back to full colour. Clicking the one that is already
    // on clears the group instead of re-checking it. (The native re-check is
    // prevented, so no `onChange` fires — the deselection is the onClick's own
    // write, one `setAdjustment` and one `commit`.)
    renderPanel();

    fireEvent.click(bwRadio());
    setAdjustment.mockClear();
    commit.mockClear();
    fireEvent.click(bwRadio());

    expect(setAdjustment).toHaveBeenCalledWith('template', 0);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(bwRadio()).not.toBeChecked();
  });
});
