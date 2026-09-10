import { Group, Slider, Stack, Text, Tooltip } from '@mantine/core';
import classes from '../styles/GradientSlider.module.css';
import { useHover } from '@mantine/hooks';
import { useEditor } from '../../../editor/editorContext';
import { useTranslation } from 'react-i18next';
import { usePreferences } from '../../../preferences/preferences';
import { IconInfoCircle } from '@tabler/icons-react';

interface GradientSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onChangeEnd: () => void;
  gradient: string;
  /**
   * Restores the slider to its default. Given by the owner, the only place that
   * knows which value this row writes and what its default is. Omit it and the
   * label is inert — a row that resets nothing is better than one that resets
   * the wrong thing.
   */
  onReset?: () => void;
}

export function GradientSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  gradient,
  onChangeEnd,
  onReset,
}: GradientSliderProps) {
  const { hovered, ref } = useHover();
  const { image } = useEditor();
  const { t } = useTranslation(['common']);
  const showReset = hovered && onReset !== undefined;
  const {preferences} = usePreferences();
  return (
    <Stack gap={4} className={classes.root} style={{ '--gradient': gradient } as React.CSSProperties}>
      <Group justify="space-between" gap="xs">
        {/* Both texts stay in the DOM, stacked in one grid cell, and only their
            visibility swaps, so the box never resizes out from under the
            pointer while hovering. */}
        {preferences.helper ? 
          <Tooltip label={label}>
              <IconInfoCircle size="1rem" stroke={2} color="var(--mantine-color-dimmed)"  />
          </Tooltip>: null
        }
        <Text
          size="sm"
          className={classes.label}
          onClick={onReset}
          style={{ cursor: onReset === undefined ? 'default' : 'pointer' }}
          ref={ref}
        >
          <span style={{ visibility: showReset ? 'hidden' : 'visible' }}>{label}</span>
          <span style={{ visibility: showReset ? 'visible' : 'hidden' }}>{t('common.reset')}</span>
        </Text>
        <Text size="sm" c="dimmed">
          {value}
        </Text>
      </Group>
      <Slider
        value={value}
        onChange={onChange}
        disabled={image === null}
        onChangeEnd={onChangeEnd}
        min={min}
        max={max}
        step={step}
        label={null}
        thumbLabel={label}
      />
    </Stack>
  );
}
