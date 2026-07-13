import { Group, NumberInput, Radio, Stack, Switch, useMantineColorScheme } from '@mantine/core';
import { usePreferences, MIN_FONT_SIZE, MAX_FONT_SIZE } from '../../../preferences/preferences';
import type { PanelPosition } from '../../../preferences/preferences';

/**
 * General preferences tab: tool-rail side, light/dark theme and the base font
 * size. Every control writes through to the persisted preferences store (theme
 * is delegated to Mantine's color-scheme manager, which persists on its own).
 */
export function General() {
  const { preferences, setPanelPosition, setFontSize } = usePreferences();
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <Stack gap="md" w={260}>
      <Radio.Group
        value={preferences.panelPosition}
        onChange={(value) => value && setPanelPosition(value as PanelPosition)}
        name="panelPosition"
        label="Panel position"
        mt="xs"
    >
      <Group mt="xs">
        <Radio value="left" label="Left" />
        <Radio value="right" label="Right" />
      </Group>
    </Radio.Group>

      <Switch
        label="Dark theme"
        checked={colorScheme === 'dark'}
        onChange={(event) =>
          setColorScheme(event.currentTarget.checked ? 'dark' : 'light')
        }
      />

      <NumberInput
        label="Font"
        value={preferences.fontSize}
        onChange={(value) =>
          typeof value === 'number' && setFontSize(value)
        }
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
      />
    </Stack>
  );
}
