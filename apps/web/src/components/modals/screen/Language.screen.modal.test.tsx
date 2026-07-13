import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { render, screen } from '../../../test/render';
import { Language } from './Language.screen.modal';
import { loadPreferences } from '../../../preferences/preferences';

afterEach(() => {
  localStorage.clear();
});

// A Mantine Select renders both a visible input and a hidden one under the same
// label, so queries must target the visible input explicitly.
const VISIBLE_INPUT = { selector: 'input:not([type="hidden"])' } as const;

describe('Language preferences', () => {
  it('shows English as the default selection', () => {
    render(<Language />);

    expect(screen.getByLabelText('Language', VISIBLE_INPUT)).toHaveValue('English');
  });

  it('persists the chosen language', async () => {
    const user = userEvent.setup();
    render(<Language />);

    await user.click(screen.getByLabelText('Language', VISIBLE_INPUT));
    await user.click(await screen.findByRole('option', { name: 'Castellano', hidden: true }));

    expect(screen.getByLabelText('Language', VISIBLE_INPUT)).toHaveValue('Castellano');
    expect(loadPreferences().language).toBe('es');
  });
});
