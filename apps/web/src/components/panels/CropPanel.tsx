import { SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { useEditor } from '../../editor/editorContext';

const aspectRatios = ['Original', '1:1', '16:9', '4:3', '3:2', '5:4', 'Free'];

/**
 * Crop tool panel. Exposes the aspect-ratio selector, wired to the shared editor
 * store so the crop overlay can constrain the draft to the chosen ratio.
 */
export function CropPanel() {
  const { cropRatio, setCropRatio, commit, image, clearCrop, cropRegion } = useEditor();

  // Picking a ratio is a discrete edit: apply it, then checkpoint it as one undo step.
  const handleRatioChange = (value: string) => {
    setCropRatio(value);
    commit();
  };

  const keyDownHandler = (e: globalThis.KeyboardEvent) => {
    if(e.key === 'Escape') {
      setCropRatio('');
    }
  }

  return (
    <Stack gap="sm" onKeyDown={() => keyDownHandler}>
      <Title order={5}>Crop</Title>
      <Text size="sm" c="dimmed">
        Aspect ratio
      </Text>
      <SegmentedControl
        orientation="vertical"
        disabled={image === null}
        fullWidth
        value={cropRatio}
        onChange={handleRatioChange}
        data={aspectRatios}
      />
    </Stack>
  );
}
