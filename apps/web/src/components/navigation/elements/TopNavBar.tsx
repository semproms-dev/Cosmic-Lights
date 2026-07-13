import { useState } from 'react';

import {
  IconHome2,
  IconSettings,
  IconFile,
  IconFolderOpen,
  IconPhoto,
  IconInfoCircle
} from '@tabler/icons-react';
import { Group, Tooltip, UnstyledButton, Menu, ActionIcon } from '@mantine/core';
import classes from '../styles/TopNavBar.module.css';
import { FaRedoAlt, FaUndoAlt } from "react-icons/fa";
import { useEditor } from '../../../editor/editorContext';
import { useModals } from '@mantine/modals';
import { AdjustementsModal } from '../../modals/Adjustments.modal';

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
  const {redo, undo, canRedo, canUndo} = useEditor();
  const modals = useModals();

  const openSettings = () => {
    modals.openModal({
      title: 'Settings',
      size: 'lg',
      children: <AdjustementsModal />,
    });
  };

  const mainLinksMockdata: MainLink[] = [
  { icon: IconFile, label: 'File', items: [
    { icon: IconFolderOpen, label: 'Open...', onClick: () => onOpenImage?.()},
    { icon: IconPhoto, label: 'Export JPG...', onClick: () => {} }
  ], onClick: () => {}},
  { icon: IconHome2, label: 'Hello', items: [
    { icon: IconInfoCircle, label: 'About CosmicLights', onClick: () => {} }
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
        <Tooltip label='Undo' withArrow>
          <ActionIcon variant='subtle' size="lg" onClick={() => undo()} disabled={!canUndo}>
            <FaUndoAlt />
          </ActionIcon>
        </Tooltip>
        <Tooltip label='Redo' withArrow>
          <ActionIcon variant='subtle' size="lg" onClick={() => redo()} disabled={!canRedo}>
            <FaRedoAlt />
          </ActionIcon>
        </Tooltip>
        <Tooltip label='Settings' withArrow>
          <ActionIcon variant='subtle' size="lg" onClick={openSettings} aria-label="Settings">
            <IconSettings size={22} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </nav>
  );
}
