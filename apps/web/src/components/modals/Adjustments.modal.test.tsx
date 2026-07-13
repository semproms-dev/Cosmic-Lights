import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '../../test/render';
import { AdjustementsModal } from './Adjustments.modal';

afterEach(() => {
  localStorage.clear();
});

// A Mantine Select renders both a visible input and a hidden one under the same
// label, so queries must target the visible input explicitly.
const VISIBLE_INPUT = { selector: 'input:not([type="hidden"])' } as const;

describe('AdjustementsModal', () => {
  it('lists the General and Language categories', () => {
    render(<AdjustementsModal />);

    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Language' })).toBeInTheDocument();
  });

  it('shows the General panel by default', () => {
    render(<AdjustementsModal />);

    expect(screen.getByLabelText('Panel position', VISIBLE_INPUT)).toBeInTheDocument();
    expect(screen.getByLabelText('Dark theme')).toBeInTheDocument();
    expect(screen.getByLabelText('Font')).toBeInTheDocument();
  });

  it('reveals the Language panel when its tab is selected', async () => {
    const user = userEvent.setup();
    render(<AdjustementsModal />);

    await user.click(screen.getByRole('tab', { name: 'Language' }));

    expect(
      await screen.findByLabelText('Language', VISIBLE_INPUT),
    ).toBeInTheDocument();
  });
});
