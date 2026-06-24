import { Group, Slider, Stack, Text } from '@mantine/core';
import classes from '../styles/ControlSlider.module.css';

interface ControlSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

/**
 * A single labelled adjustment row: the control's name, its current value and a
 * Mantine `Slider`. Purely presentational and controlled — it owns no state and
 * reports every change to the parent via `onChange`.
 */
export function ControlSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: ControlSliderProps) {
  return (
    <Stack gap={4} className={classes.control}>
      <Group justify="space-between" gap="xs">
        <Text size="sm">{label}</Text>
        <Text size="sm" c="dimmed">
          {value}
        </Text>
      </Group>
      <Slider
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        label={null}
        thumbLabel={label}
      />
    </Stack>
  );
}
