import {
  IconInfoCircle,
  IconAdjustments,
  IconCrop,
  IconFileExport
} from '@tabler/icons-react';
import { Stack, Tooltip, UnstyledButton } from '@mantine/core';
import classes from '../styles/LateralNavBar.module.css';

interface RightNavBarProps {
    active: string;
    onChange: (label: string) => void
}

interface ToolLink {
  label: string;
  icon: typeof IconInfoCircle;
}

const lateralNavBarButtons: ToolLink[] = [
  { icon: IconInfoCircle, label: 'Info' },
  { icon: IconAdjustments, label: 'Adjustments' },
  { icon: IconCrop, label: 'Crop' },
  { icon: IconFileExport, label: 'Export' }
];

/**
 * Vertical tool rail on the right edge of the editor.
 *
 * Controlled component: the parent owns the active selection so the matching
 * tool panel can be rendered alongside the rail. Selecting a tool calls
 * `onChange` with its label.
 */
export function LateralNavBar({ active, onChange }: RightNavBarProps) {
  const tools = lateralNavBarButtons.map((tool) => (
    <Tooltip
      key={tool.label}
      label={tool.label}
      position="right"
      withArrow
      transitionProps={{ duration: 0 }}
    >
      <UnstyledButton
        onClick={() => onChange(tool.label)}
        className={classes.toolLink}
        data-active={tool.label === active || undefined}
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
