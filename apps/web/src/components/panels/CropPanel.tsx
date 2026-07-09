import { SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { useEditor } from '../../editor/editorContext';

const aspectRatios = ['Original', '1:1', '16:9', '4:3', '3:2', '5:4', 'Free'];

/**
 * Crop tool panel. Exposes the aspect-ratio selector, wired to the shared editor
 * store so the crop overlay can constrain the draft to the chosen ratio.
 */
export function CropPanel() {
  const { cropRatio, setCropRatio } = useEditor();

  return (
    <Stack gap="sm">
      <Title order={5}>Crop</Title>
      <Text size="sm" c="dimmed">
        Aspect ratio
      </Text>
      <SegmentedControl
        orientation="vertical"
        fullWidth
        value={cropRatio}
        onChange={setCropRatio}
        data={aspectRatios}
      />
    </Stack>
  );
}
