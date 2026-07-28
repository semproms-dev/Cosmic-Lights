import {
  IconInfoCircle,
  IconAdjustments,
  IconCrop,
  IconKeyboard,
  IconFileExport,
  IconMask,
  IconGift
} from '@tabler/icons-react';
import { Stack, Tooltip, UnstyledButton } from '@mantine/core';
import classes from '../styles/LateralNavBar.module.css';
import { useTranslation } from 'react-i18next';

interface RightNavBarProps {
    active: string;
    onChange: (label: string) => void
}

interface ToolLink {
  label: string;
  icon: typeof IconInfoCircle;
  navKey: string;
}

const getLateralNavBarButtons = (t: (key: string) => string): ToolLink[] => [
  { icon: IconInfoCircle, label: t('nav.info'), navKey: 'info' },
  { icon: IconAdjustments, label: t('nav.adjustments'), navKey: 'adjustments' },
  { icon: IconMask, label: t('nav.masks'), navKey: 'masks' },
  { icon: IconCrop, label: t('nav.crop'), navKey: 'crop' },
  { icon: IconKeyboard, label: t('nav.shortcuts'), navKey: 'shortcuts' },
  { icon: IconGift, label: t('nav.presets'), navKey: 'presets'},
  { icon: IconFileExport, label: t('nav.export'), navKey: 'export' }
];

/**
 * Vertical tool rail on the right edge of the editor.
 *
 * Controlled component: the parent owns the active selection so the matching
 * tool panel can be rendered alongside the rail. Selecting a tool calls
 * `onChange` with its label.
 */
export function LateralNavBar({ active, onChange }: RightNavBarProps) {
  const { t } = useTranslation(['common']);
  const tools = getLateralNavBarButtons(t).map((tool) => (
    <Tooltip
      key={tool.navKey}
      label={tool.label}
      position="right"
      withArrow
      transitionProps={{ duration: 0 }}
    >
      <UnstyledButton
        onClick={() => onChange(tool.navKey)}
        className={classes.toolLink}
        data-active={tool.navKey === active || undefined}
        aria-label={tool.label}
      >
        <tool.icon size={22} stroke={1.5} />
      </UnstyledButton>
    </Tooltip>
  ));

  return (
    <nav className={classes.sidebar} aria-label="Editing tools">
      <Stack gap="xs" align="center">{tools}</Stack>
    </nav>
  );
}
