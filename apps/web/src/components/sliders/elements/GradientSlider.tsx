import { Slider, type SliderProps } from '@mantine/core';

interface GradientSliderProps extends SliderProps {
  gradient: string;
}

export function GradientSlider({ gradient, ...props }: GradientSliderProps) {
  return (
    <Slider
      min={-100}
      max={100}
      defaultValue={0}
      label={null}
      size={6}          // track thickness
      thumbSize={18}
      styles={{
        track: { background: gradient },
        bar: { background: 'transparent' },   // don't let the fill cover the gradient
        thumb: {
          background: '#fff',
          borderColor: 'rgba(0,0,0,0.15)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        },
      }}
      {...props}
    />
  );
}