import { Select, Stack } from '@mantine/core';
import { usePreferences } from '../../../preferences/preferences';
import type { Language as LanguageCode } from '../../../preferences/preferences';

const LANGUAGES = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Castellano' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
];

/**
 * Language preferences tab: picks the interface language. The choice is
 * persisted and synced with the i18n runtime.
 */
export function Language() {
  const { preferences, setLanguage } = usePreferences();

  return (
    <Stack gap="md" w={260}>
      <Select
        label="Language"
        data={LANGUAGES}
        value={preferences.language}
        onChange={(value) => value && setLanguage(value as LanguageCode)}
        allowDeselect={false}
      />
    </Stack>
  );
}
