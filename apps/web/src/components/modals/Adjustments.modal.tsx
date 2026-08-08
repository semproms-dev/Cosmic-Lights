import { useEffect } from 'react';
import { Tabs } from '@mantine/core';
import { useModals } from '@mantine/modals';
import { General } from './screen/General.screen.modal';
import { Language } from './screen/Language.screen.modal';
import { useTranslation } from 'react-i18next';

interface AdjustementsModalProps {
  /** Id of the Mantine modal rendering this body; used to refresh its title. */
  modalId: string;
}

/**
 * Settings dialog body. A vertical tab list on the left switches between the
 * preference categories shown on the right. Rendered inside a Mantine modal by
 * the Settings menu.
 */
export function AdjustementsModal({ modalId }: AdjustementsModalProps) {
  const { t } = useTranslation(['common']);
  const { updateModal } = useModals();

  useEffect(() => {
    updateModal({ modalId, title: t('topNav.settings') });
  }, [modalId, updateModal, t]);

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
