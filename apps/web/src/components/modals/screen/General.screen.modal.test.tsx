import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { fireEvent, render, screen, within } from '../../../test/render';
import { General } from './General.screen.modal';
import { loadPreferences } from '../../../preferences/preferences';

afterEach(() => {
  localStorage.clear();
});

// Mantine's NumberInput wraps the native <input> in a div; query by label text
// targeting the visible input.
const VISIBLE_INPUT = { selector: 'input:not([type="hidden"])' } as const;

const panelPositionGroup = () =>
  screen.getByRole('radiogroup', { name: 'Panel position' });
const menuPositionGroup = () =>
  screen.getByRole('radiogroup', { name: 'Menu position' });
const navBarPositionGroup = () =>
  screen.getByRole('radiogroup', { name: 'Toolbar position' });

describe('General preferences', () => {
  it('renders the controls at their default values', () => {
    render(<General />);

    expect(
      within(panelPositionGroup()).getByRole('radio', { name: 'Right', checked: true }),
    ).toBeInTheDocument();
    expect(
      within(menuPositionGroup()).getByRole('radio', { name: 'Left', checked: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Dark theme' })).toBeChecked();
    expect(screen.getByLabelText('Font', VISIBLE_INPUT)).toHaveValue('16');
  });

  it('persists the chosen panel position', async () => {
    const user = userEvent.setup();
    render(<General />);

    await user.click(within(panelPositionGroup()).getByRole('radio', { name: 'Left' }));

    expect(
      within(panelPositionGroup()).getByRole('radio', { name: 'Left', checked: true }),
    ).toBeInTheDocument();
    expect(loadPreferences().panelPosition).toBe('left');
  });

  it('persists the chosen menu position', async () => {
    const user = userEvent.setup();
    render(<General />);

    await user.click(within(menuPositionGroup()).getByRole('radio', { name: 'Right' }));

    expect(
      within(menuPositionGroup()).getByRole('radio', { name: 'Right', checked: true }),
    ).toBeInTheDocument();
    expect(loadPreferences().menuPosition).toBe('right');
  });

  it('persists the chosen top bar position', async () => {
    const user = userEvent.setup();
    render(<General />);

    expect(
      within(navBarPositionGroup()).getByRole('radio', { name: 'Top', checked: true }),
    ).toBeInTheDocument();

    await user.click(within(navBarPositionGroup()).getByRole('radio', { name: 'Bottom' }));

    expect(
      within(navBarPositionGroup()).getByRole('radio', { name: 'Bottom', checked: true }),
    ).toBeInTheDocument();
    expect(loadPreferences().navBarPosition).toBe('bottom');
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

  it('rejects a font size outside the bounds', () => {
    render(<General />);

    const fontInput = screen.getByLabelText('Font', VISIBLE_INPUT);
    fireEvent.change(fontInput, { target: { value: '20' } });
    expect(screen.getByLabelText('Font', VISIBLE_INPUT)).toHaveValue('20');

    fireEvent.change(screen.getByLabelText('Font', VISIBLE_INPUT), { target: { value: '999' } });
    expect(screen.getByLabelText('Font', VISIBLE_INPUT)).toHaveValue('20');
    expect(loadPreferences().fontSize).toBe(20);

    fireEvent.change(screen.getByLabelText('Font', VISIBLE_INPUT), { target: { value: '1' } });
    expect(screen.getByLabelText('Font', VISIBLE_INPUT)).toHaveValue('20');
    expect(loadPreferences().fontSize).toBe(20);
  });
});
