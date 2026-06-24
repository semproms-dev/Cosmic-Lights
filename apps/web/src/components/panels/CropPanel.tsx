import { useState } from 'react';
import { SegmentedControl, Stack, Text, Title } from '@mantine/core';

const aspectRatios = ['Original', '1:1', '16:9', '4:3', '3:2', 'Free'];

/**
 * Crop tool panel. Currently exposes the aspect-ratio selector only; the
 * draggable crop overlay arrives with the editor canvas.
 */
export function CropPanel() {
  const [ratio, setRatio] = useState('Original');

  return (
    <Stack gap="sm">
      <Title order={5}>Crop</Title>
      <Text size="sm" c="dimmed">
        Aspect ratio
      </Text>
      <SegmentedControl
        orientation="vertical"
        fullWidth
        value={ratio}
        onChange={setRatio}
        data={aspectRatios}
      />
    </Stack>
  );
}
