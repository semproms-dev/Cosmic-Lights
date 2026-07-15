import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '../../test/render';
import { AdjustementsModal } from './Adjustments.modal';

afterEach(() => {
  localStorage.clear();
});

// Mantine's NumberInput wraps the native <input> in a div; query by label text
// targeting the visible input.
const VISIBLE_INPUT = { selector: 'input:not([type="hidden"])' } as const;

describe('AdjustementsModal', () => {
  it('lists the General and Language categories', () => {
    render(<AdjustementsModal />);

    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Language' })).toBeInTheDocument();
  });

  it('shows the General panel by default', () => {
    render(<AdjustementsModal />);

    expect(screen.getByRole('radio', { name: 'Right' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Dark theme' })).toBeInTheDocument();
    expect(screen.getByLabelText('Font', VISIBLE_INPUT)).toBeInTheDocument();
  });

  it('reveals the Language panel when its tab is selected', async () => {
    const user = userEvent.setup();
    render(<AdjustementsModal />);

    await user.click(screen.getByRole('tab', { name: 'Language' }));

    expect(
      await screen.findByRole('combobox', { name: 'Language' }),
    ).toBeInTheDocument();
  });
});
