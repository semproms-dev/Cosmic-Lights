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
const appearanceGroup = () =>
  screen.getByRole('radiogroup', { name: 'Appearance' });
const themeSelect = () =>
  screen.getByRole('combobox', { name: 'Theme' });

describe('General preferences', () => {
  it('renders the controls at their default values', () => {
    render(<General />);

    expect(
      within(panelPositionGroup()).getByRole('radio', { name: 'Right', checked: true }),
    ).toBeInTheDocument();
    expect(
      within(menuPositionGroup()).getByRole('radio', { name: 'Left', checked: true }),
    ).toBeInTheDocument();
    expect(
      within(appearanceGroup()).getByRole('radio', { name: 'Dark', checked: true }),
    ).toBeInTheDocument();
    expect(themeSelect()).toHaveValue('Violet');
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

  it('persists the chosen appearance', async () => {
    const user = userEvent.setup();
    render(<General />);

    await user.click(within(appearanceGroup()).getByRole('radio', { name: 'Light' }));

    expect(
      within(appearanceGroup()).getByRole('radio', { name: 'Light', checked: true }),
    ).toBeInTheDocument();
    expect(loadPreferences().appearance).toBe('light');
  });

  it('persists the chosen theme preset', async () => {
    const user = userEvent.setup();
    render(<General />);

    await user.click(themeSelect());
    // jsdom gives the Select's reference element no layout, so floating-ui
    // reports it hidden and the popover never becomes "visible" here. The
    // options are still in the DOM, so select one directly.
    const pinkOption = screen
      .getAllByRole('option', { hidden: true })
      .find((option) => option.textContent === 'Pink');
    if (!pinkOption) {
      throw new Error('Pink theme option not found');
    }
    fireEvent.click(pinkOption);

    expect(loadPreferences().theme).toBe('pink');
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
