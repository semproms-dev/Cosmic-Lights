import { ActionIcon, Group, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { useEditor } from '../../editor/editorContext';
import { FaArrowRotateLeft } from "react-icons/fa6";
import { FaArrowRotateRight } from "react-icons/fa6";
import { LuFlipHorizontal2 } from "react-icons/lu";
import { LuFlipVertical2 } from "react-icons/lu";

const aspectRatios = ['Original', '1:1', '16:9', '4:3', '3:2', '5:4', 'Free'];

/**
 * Crop tool panel. Exposes the aspect-ratio selector, wired to the shared editor
 * store so the crop overlay can constrain the draft to the chosen ratio.
 */
export function CropPanel() {
  const { cropRatio, setCropRatio, commit, image, clearCrop, cropRegion, rotateCcw, rotateCw, flipH, flipV } = useEditor();

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
      <Group>
        <Text>Rotar y voltear:</Text>
        <ActionIcon>
          <FaArrowRotateLeft cursor={'pointer'} onClick={() => {rotateCcw(); commit();}}/>
        </ActionIcon>
        <ActionIcon>
          <FaArrowRotateRight cursor={'pointer'} onClick={() => {rotateCw(); commit();}}/>
        </ActionIcon>
        <ActionIcon>
          <LuFlipHorizontal2 cursor={'pointer'} onClick={() => {flipH(); commit();}}/>
        </ActionIcon>
        <ActionIcon>
          <LuFlipVertical2 cursor={'pointer'} onClick={() => {flipV(); commit()}}/>
        </ActionIcon>
      </Group>

    </Stack>
  );
}
