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
  const showReset = hovered && onReset !== undefined;
  return (
    <Stack gap={4} className={classes.control}>
      <Group justify="space-between" gap="xs">
         <Group gap={6}>
         {preferences.helper ? 
          <Tooltip label={description ?? label}>
              <IconInfoCircle size={16} stroke={2} color="var(--mantine-color-dimmed)"  />
            </Tooltip>: null
          }
          {/*
            Both texts stay in the DOM, stacked in one grid cell, and only their
            visibility swaps. Replacing the text outright is what caused the
            label to flicker: "Reset" is shorter than most labels, so the element
            shrank out from under the pointer, the hover went false, the long
            label came back under the pointer, and round it went. Sharing a cell
            keeps the box as wide as the wider of the two, whatever is showing.
            The visibility is inline rather than a class so that jsdom — which
            never applies the stylesheet — can still see which one is showing.
          */}
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
