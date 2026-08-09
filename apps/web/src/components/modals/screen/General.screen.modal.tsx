import { Box, Group, NumberInput, Radio, Select, Stack, Switch, Text } from '@mantine/core';
import { usePreferences, MIN_FONT_SIZE, MAX_FONT_SIZE } from '../../../preferences/preferences';
import type { Appearance, NavBarPosition, PanelPosition } from '../../../preferences/preferences';
import { getThemePreset, THEME_PRESETS } from '../../../preferences/themePresets';
import type { ThemePresetId } from '../../../preferences/themePresets';
import { useTranslation } from 'react-i18next';

/**
 * General preferences tab: tool-rail side, colour appearance, accent theme and
 * the base font size. Every control writes through to the persisted preferences
 * store, which drives the Mantine colour scheme and theme in AppTheme.
 */
export function General() {
  const { t } = useTranslation(['common']);
  const {
    preferences,
    setPanelPosition,
    setAppearance,
    setTheme,
    setFontSize,
    setHelpers,
    setMenuPosition,
    setNavBarPosition,
  } = usePreferences();

  return (
    <Stack gap="md" w={260}>
      <Radio.Group
        value={preferences.panelPosition}
        onChange={(value) => value && setPanelPosition(value as PanelPosition)}
        name="panelPosition"
        label={t('settings.panelPosition')}
        mt="xs"
      >
        <Group mt="xs">
          <Radio value="left" label={t('settings.left')} />
          <Radio value="right" label={t('settings.right')} />
        </Group>
      </Radio.Group>

      <Radio.Group
        value={preferences.menuPosition}
        onChange={(value) => value && setMenuPosition(value)}
        name='menuPosition'
        label={t('settings.menuPosition')}
        mt={'xs'}
      >
        <Group mt="xs">
          <Radio value="left" label={t('settings.left')} />
          <Radio value="right" label={t('settings.right')} />
        </Group>
      </Radio.Group>

      <Radio.Group
        value={preferences.navBarPosition}
        onChange={(value) => value && setNavBarPosition(value as NavBarPosition)}
        name="navBarPosition"
        label={t('settings.navBarPosition')}
        mt="xs"
      >
        <Group mt="xs">
          <Radio value="top" label={t('settings.top')} />
          <Radio value="bottom" label={t('settings.bottom')} />
        </Group>
      </Radio.Group>

      <Radio.Group
        value={preferences.appearance}
        onChange={(value) => value && setAppearance(value as Appearance)}
        name="appearance"
        label={t('settings.appearance')}
        mt="xs"
      >
        <Group mt="xs">
          <Radio value="light" label={t('settings.appearanceLight')} />
          <Radio value="dark" label={t('settings.appearanceDark')} />
          <Radio value="auto" label={t('settings.appearanceAuto')} />
        </Group>
      </Radio.Group>

      <Select
        data={THEME_PRESETS.map((theme) => ({
          value: theme.id,
          label: t(theme.labelKey),
        }))}
        renderOption={({ option }) => {
          const preset = getThemePreset(option.value as ThemePresetId);
          return (
            <Group gap="sm" wrap="nowrap">
              <Box
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: '1px solid var(--mantine-color-gray-4)',
                  backgroundColor: `var(--mantine-color-${preset.primaryColor}-6)`,
                }}
              />
              <Text>{option.label}</Text>
            </Group>
          );
        }}
        value={preferences.theme}
        onChange={(value) => value && setTheme(value as ThemePresetId)}
        label={t('settings.theme')}
        mt="xs"
      />

      <Switch
        label={t('settings.helpers')}
        checked={preferences.helper === true}
        onChange={() =>
          setHelpers(!preferences.helper)
        }
      />

      <NumberInput
        label={t('settings.font')}
        value={preferences.fontSize}
        onChange={(value) =>
          typeof value === 'number' && setFontSize(value)
        }
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
        clampBehavior="strict"
      />
    </Stack>
  );
}
