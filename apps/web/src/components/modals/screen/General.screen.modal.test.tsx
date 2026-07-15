import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { fireEvent, render, screen } from '../../../test/render';
import { General } from './General.screen.modal';
import { loadPreferences } from '../../../preferences/preferences';

afterEach(() => {
  localStorage.clear();
});

// Mantine's NumberInput wraps the native <input> in a div; query by label text
// targeting the visible input.
const VISIBLE_INPUT = { selector: 'input:not([type="hidden"])' } as const;

describe('General preferences', () => {
  it('renders the controls at their default values', () => {
    render(<General />);

    expect(screen.getByRole('radio', { name: 'Right', checked: true })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Dark theme' })).toBeChecked();
    expect(screen.getByLabelText('Font', VISIBLE_INPUT)).toHaveValue('14');
  });

  it('persists the chosen panel position', async () => {
    const user = userEvent.setup();
    render(<General />);

    await user.click(screen.getByRole('radio', { name: 'Left' }));

    expect(screen.getByRole('radio', { name: 'Left', checked: true })).toBeInTheDocument();
    expect(loadPreferences().panelPosition).toBe('left');
  });

  it('toggles the color scheme via the theme switch', async () => {
    const user = userEvent.setup();
    render(<General />);

    const themeSwitch = screen.getByRole('switch', { name: 'Dark theme' });
    expect(themeSwitch).toBeChecked();

    await user.click(themeSwitch);

    expect(themeSwitch).not.toBeChecked();
  });

  it('persists the font size', () => {
    render(<General />);

    fireEvent.change(screen.getByLabelText('Font', VISIBLE_INPUT), { target: { value: '20' } });

    expect(screen.getByLabelText('Font', VISIBLE_INPUT)).toHaveValue('20');
    expect(loadPreferences().fontSize).toBe(20);
  });
});
