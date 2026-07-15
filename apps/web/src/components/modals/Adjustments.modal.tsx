import { Tabs } from '@mantine/core';
import { General } from './screen/General.screen.modal';
import { Language } from './screen/Language.screen.modal';
import { useTranslation } from 'react-i18next';

/**
 * Settings dialog body. A vertical tab list on the left switches between the
 * preference categories shown on the right. Rendered inside a Mantine modal by
 * the Settings menu.
 */
export function AdjustementsModal() {
  const { t } = useTranslation(['common']);

  return (
    <Tabs defaultValue="general" orientation="vertical" variant="pills">
      <Tabs.List>
        <Tabs.Tab value="general">{t('settings.general')}</Tabs.Tab>
        <Tabs.Tab value="language">{t('settings.language')}</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="general" pl="md">
        <General />
      </Tabs.Panel>
      <Tabs.Panel value="language" pl="md">
        <Language />
      </Tabs.Panel>
    </Tabs>
  );
}
