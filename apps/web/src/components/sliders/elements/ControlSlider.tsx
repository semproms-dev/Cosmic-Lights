import { Group, Slider, Stack, Text } from '@mantine/core';
import classes from '../styles/ControlSlider.module.css';
import { useHover } from '@mantine/hooks';
import { useEditor } from '../../../editor/editorContext';

interface ControlSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onChangeEnd: () => void;
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
  onChangeEnd,
}: ControlSliderProps) {
  const { hovered, ref } = useHover();
  const {setAdjustment, commit} = useEditor();

  // Resetting via the label is a discrete edit outside the slider's onChangeEnd,
  // so it needs its own checkpoint.
  const handleReset = () => {
    setAdjustment(label.toLocaleLowerCase(), 0);
    commit();
  };
  return (
    <Stack gap={4} className={classes.control}>
      <Group justify="space-between" gap="xs">
        <Text size="sm" onClick={handleReset} style={{cursor: 'pointer'}} ref={ref}>{hovered ? 'Reset' : label}</Text>
        <Text size="sm" c="dimmed">
          {value}
        </Text>
      </Group>
      <Slider
        value={value}
        onChange={onChange}
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
