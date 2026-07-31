import { useState } from 'react';

import {
  IconSettings,
  IconFile,
  IconFolderOpen,
  IconPhoto,
  IconInfoCircle,
} from '@tabler/icons-react';
import { Group, Tooltip, UnstyledButton, Menu, ActionIcon } from '@mantine/core';
import classes from '../styles/TopNavBar.module.css';
import { FaRedoAlt, FaUndoAlt } from "react-icons/fa";
import { useEditor } from '../../../editor/editorContext';
import { useModals } from '@mantine/modals';
import { AdjustementsModal } from '../../modals/Adjustments.modal';
import { AboutModal } from '../../modals/About.modal';
import { useTranslation } from 'react-i18next';
import { IconRestore } from '@tabler/icons-react';

interface MenuItem {
  label: string;
  icon: typeof IconFile,
  onClick: () => void
}

interface MainLink {
  label: string;
  icon: typeof IconFile,
  items: MenuItem[],
  onClick: () => void
}


interface NavBarProps {
  /** Opens the image picker; wired to the shared file input by the host. */
  onOpenImage?: () => void;
}

export function NavBar({ onOpenImage }: NavBarProps = {}) {
  const [active, setActive] = useState('File');
  const [openedLabel, setOpenedLabel] = useState('');
  const {redo, undo, canRedo, canUndo, openResetDialog} = useEditor();
  const modals = useModals();
  const { t } = useTranslation(['common']);

  const openSettings = () => {
    modals.openModal({
      title: t('topNav.settings'),
      size: 'lg',
      children: <AdjustementsModal />,
    });
  };

  const openAbout = () => {
    modals.openModal({
      title: t('topNav.about'),
      size: 'md',
      children: <AboutModal />
    })
  }

  const mainLinksMockdata: MainLink[] = [
  { icon: IconFile, label: t('topNav.file'), items: [
    { icon: IconFolderOpen, label: t('topNav.open'), onClick: () => onOpenImage?.()},
    { icon: IconPhoto, label: t('topNav.exportJpg'), onClick: () => {} }
  ], onClick: () => {}}
];

  const mainLinks = mainLinksMockdata.map((link) => (
    <Menu
      key={link.label}
      trigger='click'
      position='bottom-start'
      withArrow
      onOpen={() => {
          setActive(link.label)
          setOpenedLabel(link.label)
        }
      }
      onClose={() => setOpenedLabel('')}
    >
        <Menu.Target>
          <Tooltip
            label={link.label}
            visibleFrom=''
            disabled={openedLabel === link.label}
            position="bottom"
            withArrow
            transitionProps={{ duration: 0 }}
          >
            <UnstyledButton
              className={classes.mainLink}
              data-active={link.label === active || undefined}
              aria-label={link.label}
            >
              <link.icon size={22} stroke={1.5} />
            </UnstyledButton>
          </Tooltip>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>{link.label}</Menu.Label>
          {link.items.map((item) => (
            <Menu.Item
              key={item.label}
              leftSection={<item.icon size={16} stroke={1.5} />}
              onClick={item.onClick}
            >
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
    </Menu>
    
  ));

  return (
    <nav className={classes.navbar}>
      <Group gap="xs">{mainLinks}</Group>

      <Group gap="xs" ml="auto">
        <Tooltip label={t('topNav.undoAll')} withArrow>
          <ActionIcon variant='subtle' size="lg" onClick={() => openResetDialog()} disabled={!canUndo}>
            <IconRestore />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('topNav.undo')} withArrow>
          <ActionIcon variant='subtle' size="lg" onClick={() => undo()} disabled={!canUndo}>
            <FaUndoAlt />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('topNav.redo')} withArrow>
          <ActionIcon variant='subtle' size="lg" onClick={() => redo()} disabled={!canRedo}>
            <FaRedoAlt />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('topNav.settings')} withArrow>
          <ActionIcon variant='subtle' size="lg" onClick={openSettings} aria-label={t('topNav.settings')}>
            <IconSettings size={22} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('topNav.about')} withArrow>
          <ActionIcon variant='subtle' size="lg" onClick={openAbout} aria-label={t('topNav.about')}>
            <IconInfoCircle size={22} stroke={1.5} />
        </ActionIcon>
        </Tooltip>
      </Group>
    </nav>
  );
}
