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

  it('marks disabled shortcuts as "soon"', () => {
    render(<ShortcutsPanel />);

    // Undo/Redo ship disabled until an edit history exists.
    expect(screen.getByText(/Undo \(soon\)/)).toBeInTheDocument();
    expect(screen.getByText(/Redo \(soon\)/)).toBeInTheDocument();
  });

  it('shows the formatted combo keys', () => {
    render(<ShortcutsPanel />);

    // Open image = mod+O; reset = mod+shift+R. Their distinctive keys render as <kbd>.
    expect(screen.getByText('O')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
  });
});
