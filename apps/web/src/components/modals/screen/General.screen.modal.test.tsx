import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { fireEvent, render, screen } from '../../../test/render';
import { General } from './General.screen.modal';
import { loadPreferences } from '../../../preferences/preferences';

afterEach(() => {
  localStorage.clear();
});

// A Mantine Select renders both a visible input and a hidden one under the same
// label, so queries must target the visible input explicitly.
const VISIBLE_INPUT = { selector: 'input:not([type="hidden"])' } as const;

describe('General preferences', () => {
  it('renders the controls at their default values', () => {
    render(<General />);

    expect(screen.getByLabelText('Panel position', VISIBLE_INPUT)).toHaveValue('Right');
    expect(screen.getByLabelText('Dark theme')).toBeChecked();
    expect(screen.getByLabelText('Font')).toHaveValue('14');
  });

  it('persists the chosen panel position', async () => {
    const user = userEvent.setup();
    render(<General />);

    await user.click(screen.getByLabelText('Panel position', VISIBLE_INPUT));
    await user.click(await screen.findByRole('option', { name: 'Left', hidden: true }));

    expect(screen.getByLabelText('Panel position', VISIBLE_INPUT)).toHaveValue('Left');
    expect(loadPreferences().panelPosition).toBe('left');
  });

  it('toggles the color scheme via the theme switch', async () => {
    const user = userEvent.setup();
    render(<General />);

    const themeSwitch = screen.getByLabelText('Dark theme');
    expect(themeSwitch).toBeChecked();

    await user.click(themeSwitch);

    expect(themeSwitch).not.toBeChecked();
  });

  it('persists the font size', () => {
    render(<General />);

    fireEvent.change(screen.getByLabelText('Font'), { target: { value: '20' } });

    expect(screen.getByLabelText('Font')).toHaveValue('20');
    expect(loadPreferences().fontSize).toBe(20);
  });
});
