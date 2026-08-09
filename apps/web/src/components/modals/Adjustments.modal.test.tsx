import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, within } from '../../test/render';
import { AdjustementsModal } from './Adjustments.modal';

afterEach(() => {
  localStorage.clear();
});

// Mantine's NumberInput wraps the native <input> in a div; query by label text
// targeting the visible input.
const VISIBLE_INPUT = { selector: 'input:not([type="hidden"])' } as const;

describe('AdjustementsModal', () => {
  it('lists the General and Language categories', () => {
    render(<AdjustementsModal modalId="settings" />);

    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Language' })).toBeInTheDocument();
  });

  it('shows the General panel by default', () => {
    render(<AdjustementsModal modalId="settings" />);

    expect(
      within(screen.getByRole('radiogroup', { name: 'Panel position' })).getByRole('radio', { name: 'Right' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByLabelText('Font', VISIBLE_INPUT)).toBeInTheDocument();
  });

  it('reveals the Language panel when its tab is selected', async () => {
    const user = userEvent.setup();
    render(<AdjustementsModal modalId="settings" />);

    await user.click(screen.getByRole('tab', { name: 'Language' }));

    expect(
      await screen.findByRole('combobox', { name: 'Language' }),
    ).toBeInTheDocument();
  });
});
