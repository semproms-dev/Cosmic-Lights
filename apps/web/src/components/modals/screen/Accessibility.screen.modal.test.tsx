import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen, within } from '../../../test/render';
import { Accessibility } from './Accessibility.screen.modal';
import { loadPreferences } from '../../../preferences/preferences';

afterEach(() => {
  localStorage.clear();
});

const highContrastGroup = () =>
  screen.getByRole('radiogroup', { name: 'High contrast' });
const focusRingGroup = () =>
  screen.getByRole('radiogroup', { name: 'Focus ring' });

describe('Accessibility preferences', () => {
  it('renders the controls at their default values', () => {
    render(<Accessibility />);

    expect(
      screen.getByRole('switch', { name: 'Reduce motion' }),
    ).not.toBeChecked();
    expect(
      within(highContrastGroup()).getByRole('radio', { name: 'Auto', checked: true }),
    ).toBeInTheDocument();
    expect(
      within(focusRingGroup()).getByRole('radio', { name: 'Auto', checked: true }),
    ).toBeInTheDocument();
  });

  it('persists the reduce-motion toggle', async () => {
    const user = userEvent.setup();
    render(<Accessibility />);

    await user.click(screen.getByRole('switch', { name: 'Reduce motion' }));

    expect(loadPreferences().reduceMotion).toBe(true);
  });

  it('persists the chosen high-contrast mode', async () => {
    const user = userEvent.setup();
    render(<Accessibility />);

    await user.click(within(highContrastGroup()).getByRole('radio', { name: 'On' }));

    expect(loadPreferences().highContrast).toBe('on');
  });

  it('persists the chosen focus-ring mode', async () => {
    const user = userEvent.setup();
    render(<Accessibility />);

    await user.click(within(focusRingGroup()).getByRole('radio', { name: 'Never' }));

    expect(loadPreferences().focusRing).toBe('never');
  });
});
