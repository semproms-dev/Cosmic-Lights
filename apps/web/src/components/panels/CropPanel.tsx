import { ActionIcon, Group, SegmentedControl, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useEditor } from '../../editor/editorContext';
import { FaArrowRotateLeft } from "react-icons/fa6";
import { FaArrowRotateRight } from "react-icons/fa6";
import { LuFlipHorizontal2 } from "react-icons/lu";
import { LuFlipVertical2 } from "react-icons/lu";
import { useTranslation } from 'react-i18next';

const aspectRatios = ['Original', '1:1', '16:9', '4:3', '3:2', '5:4', 'Free'];

/**
 * Crop tool panel. Exposes the aspect-ratio selector, wired to the shared editor
 * store so the crop overlay can constrain the draft to the chosen ratio.
 */
export function CropPanel() {
  const { cropRatio, setCropRatio, commit, image, rotateCcw, rotateCw, flipH, flipV } = useEditor();
  const {t} = useTranslation(['common']);

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
        <Stack gap="xs">
          <Group wrap="nowrap" gap="xs">
            <Text size='sm'>{t('masks.rotate')}</Text>
            <Tooltip label={t('masks.rotateLeft')}>
                <ActionIcon disabled={image === null} size={'sm'} onClick={() => {rotateCcw(); commit();}}>
                <FaArrowRotateLeft style={{width: '50%'}}/>
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('masks.rotateRight')}>
              <ActionIcon disabled={image === null} size={'sm'} onClick={() => {rotateCw(); commit();}}>
                <FaArrowRotateRight style={{width: '50%'}}/>
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('masks.flipUp')}>
              <ActionIcon disabled={image === null} size={'sm'} onClick={() => {flipH(); commit();}}>
                <LuFlipHorizontal2 style={{width: '50%'}}/>
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('masks.flipDown')}>
              <ActionIcon disabled={image === null} size={'sm'} onClick={() => {flipV(); commit()}}>
                <LuFlipVertical2 style={{width: '50%'}}/>
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      </Stack>
  );
}
