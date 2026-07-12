import { describe, expect, it } from 'vitest';
import { render, screen } from '../../test/render';
import { ShortcutsPanel } from './ShortcutsPanel';
import { SHORTCUTS } from '../../editor/shortcuts';

describe('ShortcutsPanel', () => {
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
});
