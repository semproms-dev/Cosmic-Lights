import { Group, Slider, Stack, Text, Tooltip } from '@mantine/core';
import classes from '../styles/ControlSlider.module.css';
import { useHover } from '@mantine/hooks';
import { useEditor } from '../../../editor/editorContext';
import { IconInfoCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { usePreferences } from '../../../preferences/preferences';

interface ControlSliderProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onChangeEnd?: () => void;
  /**
   * Restores the control's default. Given by the owner, which is the only place
   * that knows *which* value this row writes and what its default is — the label
   * cannot say, since it is translated.
   *
   * Omit it (as the export quality slider does) and the label is inert: a row
   * that resets nothing is better than one that resets the wrong thing.
   */
  onReset?: () => void;
}

/**
 * A single labelled adjustment row: the control's name, its current value and a
 * Mantine `Slider`. Purely presentational and controlled — it owns no state and
 * reports every change to the parent via `onChange`.
 */
export function ControlSlider({
  label,
  description,
  value,
  min,
  max,
  step,
  onChange,
  onChangeEnd,
  onReset,
}: ControlSliderProps) {
  const { hovered, ref } = useHover();
  const { image } = useEditor();
  const { t } = useTranslation(['common']);
  const { preferences } = usePreferences();
  return (
    <Stack gap={4} className={classes.control}>
      <Group justify="space-between" gap="xs">
         <Group gap={6}>
         {preferences.helper ? 
          <Tooltip label={description ?? label}>
              <IconInfoCircle size={16} stroke={2} color="var(--mantine-color-dimmed)"  />
            </Tooltip>: null
          }
          <Text
            size="sm"
            onClick={onReset}
            style={{ cursor: onReset === undefined ? 'default' : 'pointer' }}
            ref={ref}
          >
            {hovered && onReset !== undefined ? t('common.reset') : label}
          </Text>
        </Group> 
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
