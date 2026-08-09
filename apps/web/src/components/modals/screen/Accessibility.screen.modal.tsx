import { SegmentedControl, Stack, Switch, Text } from '@mantine/core';
import { usePreferences } from '../../../preferences/preferences';
import type { FocusRing, HighContrast } from '../../../preferences/preferences';
import { useTranslation } from 'react-i18next';

/**
 * Accessibility preferences tab: reduce motion, high contrast and focus-ring
 * visibility. Every control writes through to the persisted preferences store,
 * which mirrors the values onto the document root for CSS to react to.
 */
export function Accessibility() {
  const { t } = useTranslation(['common']);
  const { preferences, setReduceMotion, setHighContrast, setFocusRing } = usePreferences();

  return (
    <Stack gap="md" w={260}>
      <Switch
        label={t('settings.reduceMotion')}
        checked={preferences.reduceMotion}
        onChange={(event) => setReduceMotion(event.currentTarget.checked)}
      />

      <Text size="sm" c="dimmed">
        {t('settings.highContrast')}
      </Text>
      <SegmentedControl
        fullWidth
        aria-label={t('settings.highContrast')}
        value={preferences.highContrast}
        onChange={(value) => setHighContrast(value as HighContrast)}
        data={[
          { value: 'auto', label: t('settings.highContrastAuto') },
          { value: 'on', label: t('settings.highContrastOn') },
          { value: 'off', label: t('settings.highContrastOff') },
        ]}
      />

      <Text size="sm" c="dimmed">
        {t('settings.focusRing')}
      </Text>
      <SegmentedControl
        fullWidth
        aria-label={t('settings.focusRing')}
        value={preferences.focusRing}
        onChange={(value) => setFocusRing(value as FocusRing)}
        data={[
          { value: 'auto', label: t('settings.focusRingAuto') },
          { value: 'always', label: t('settings.focusRingAlways') },
          { value: 'never', label: t('settings.focusRingNever') },
        ]}
      />
    </Stack>
  );
}
