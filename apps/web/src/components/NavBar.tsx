import { useState } from 'react';

import {
  IconGauge,
  IconHome2,
  IconSettings,
  IconFile,
  IconFolderOpen,
  IconPhoto,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconAdjustments,
  IconPalette,
  IconInfoCircle
} from '@tabler/icons-react';
import { Group, Tooltip, UnstyledButton, Menu } from '@mantine/core';
import classes from './NavBar.module.css';

interface MenuItem {
  label: string;
  icon: typeof IconFile,
  onClick: () => void
}

interface MainLink {
  label: string;
  icon: typeof IconFile,
  items: MenuItem[]
}

const mainLinksMockdata: MainLink[] = [
  { icon: IconFile, label: 'File', items: [
    { icon: IconFolderOpen, label: 'Open...', onClick: () => {} },
    { icon: IconPhoto, label: 'Export JPG...', onClick: () => {} }
  ]},
  { icon: IconGauge, label: 'Edit', items: [
    { icon: IconArrowBackUp, label: 'Undo', onClick: () => {} },
    { icon: IconArrowForwardUp, label: 'Redo', onClick: () => {} }
  ]},
  { icon: IconSettings, label: 'Settings', items: [
    { icon: IconAdjustments, label: 'Adjustments', onClick: () => {} },
    { icon: IconPalette, label: 'Color profile', onClick: () => {} }
  ]},
  { icon: IconHome2, label: 'Hello', items: [
    { icon: IconInfoCircle, label: 'About CosmicLights', onClick: () => {} }
  ]}
];

export function NavBar() {
  const [active, setActive] = useState('File');
  const [openedLabel, setOpenedLabel] = useState('');

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
    </nav>
  );
}
