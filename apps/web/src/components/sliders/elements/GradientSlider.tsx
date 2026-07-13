import { Group, Slider, Stack, Text } from '@mantine/core';
import classes from '../styles/GradientSlider.module.css';
import { useEditor } from '../../../editor/editorContext';

interface GradientSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onChangeEnd: () => void;
  gradient: string;
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
}: GradientSliderProps) {
  const {image} = useEditor()
  return (
    <Stack gap={4} className={classes.root} style={{ '--gradient': gradient } as React.CSSProperties}>
      <Group justify="space-between" gap="xs">
        <Text size="sm">{label}</Text>
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
