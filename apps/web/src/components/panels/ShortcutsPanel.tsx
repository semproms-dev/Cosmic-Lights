import { Group, Kbd, Stack, Text, Title } from '@mantine/core';
import { SHORTCUTS, formatCombo } from '../../editor/shortcuts';
import { groupBy } from '../../utils';

/**
 * Keyboard-shortcuts reference. Rendered entirely from the {@link SHORTCUTS}
 * registry — the same source the dispatcher binds — grouped by category, each
 * row showing the icon, label and the platform-formatted combo. Disabled entries
 * are dimmed and marked "soon".
 */
export function ShortcutsPanel() {
  const byCategory = groupBy(SHORTCUTS, (s) => s.category);

  return (
    <Stack gap="lg">
      <Title order={5}>Shortcuts</Title>
      {Object.entries(byCategory).map(([category, items]) => (
        <Stack key={category} gap="xs">
          <Text size="sm" c="dimmed">
            {category}
          </Text>
          {items.map((shortcut) => (
            <Group key={shortcut.id} justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <shortcut.icon size="1.125rem" stroke={1.5} />
                <Text size="sm" c={shortcut.enabled === false ? 'dimmed' : undefined}>
                  {shortcut.label}
                  {shortcut.enabled === false ? ' (soon)' : ''}
                </Text>
              </Group>
              <Group gap={4} wrap="nowrap">
                {formatCombo(shortcut.combo).map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </Group>
            </Group>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}
