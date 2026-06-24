import { useState } from 'react';
import { Button, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { ControlSlider } from '../sliders/elements/ControlSlider';

const exportFormats = ['JPG', 'PNG', 'WEBP'];

/**
 * Export tool panel: output format and quality. The Export action is disabled
 * until the export pipeline exists.
 */
export function ExportPanel() {
  const [format, setFormat] = useState('JPG');
  const [quality, setQuality] = useState(90);

  return (
    <Stack gap="md">
      <Title order={5}>Export</Title>
      <Stack gap={4}>
        <Text size="sm">Format</Text>
        <SegmentedControl
          fullWidth
          value={format}
          onChange={setFormat}
          data={exportFormats}
        />
      </Stack>
      <ControlSlider
        label="Quality"
        value={quality}
        min={0}
        max={100}
        step={1}
        onChange={setQuality}
      />
      <Button disabled>Export image</Button>
    </Stack>
  );
}
