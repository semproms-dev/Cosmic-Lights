import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '../../test/render';
import { ShortcutsPanel } from './ShortcutsPanel';
import { SHORTCUTS } from '../../editor/shortcuts';
import i18n from '../../i18n';

describe('ShortcutsPanel', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders every shortcut label from the registry', () => {
    render(<ShortcutsPanel />);

    for (const shortcut of SHORTCUTS) {
      expect(screen.getByText(new RegExp(`^${shortcut.label}`))).toBeInTheDocument();
    }
  });

  it('does not mark any shortcut as "soon" now they are all enabled', () => {
    render(<ShortcutsPanel />);

    // Undo/Redo are now wired to the edit history, so nothing ships "(soon)".
    expect(screen.queryByText(/\(soon\)/)).not.toBeInTheDocument();
    expect(screen.getByText('Undo')).toBeInTheDocument();
    expect(screen.getByText('Redo')).toBeInTheDocument();
  });

  it('shows the formatted combo keys', () => {
    render(<ShortcutsPanel />);

    // Open image = mod+O; reset = mod+shift+R. Their distinctive keys render as <kbd>.
    expect(screen.getByText('O')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('translates the title, categories, actions and combo keys', async () => {
    render(<ShortcutsPanel />);
    await act(async () => {
      await i18n.changeLanguage('es');
    });

    expect(screen.getByText('Atajos')).toBeInTheDocument();
    expect(screen.getByText('Archivo')).toBeInTheDocument();
    expect(screen.getByText('Abrir imagen')).toBeInTheDocument();
    expect(screen.getByText('Desplazar con el pincel activo')).toBeInTheDocument();
    expect(screen.getByText('Espacio')).toBeInTheDocument();
    expect(screen.getByText('clic izquierdo')).toBeInTheDocument();
    expect(screen.getAllByText('Mayús')).toHaveLength(2);
  });
});
