import { ActionIcon, Group, SegmentedControl, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useEditor } from '../../../editor/editorContext';
import { IoMdPhonePortrait } from "react-icons/io";
import { useTranslation } from 'react-i18next';
import { DistortionComponent } from './DistortionComponent';
import { OrientationComponent } from './OrientationComponent';
import { RotationComponent } from './RotationComponent';
import { IoPhoneLandscapeSharp } from 'react-icons/io5';
import { MdOutlineGridGoldenratio } from 'react-icons/md';

const aspectRatios = (t: (key: string) => string) => [
  { value: 'Original', label: t('crop.original') },
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '3:2', label: '3:2' },
  { value: '5:4', label: '5:4' },
  { value: 'Free', label: t('crop.free') },
];

/**
 * Crop tool panel. Exposes the aspect-ratio selector, wired to the shared editor
 * store so the crop overlay can constrain the draft to the chosen ratio.
 */
export function CropPanel() {
  const { cropRatio, setCropRatio, commit, setCropOrientation, image, cropOrientation } = useEditor();
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
      <Title order={5}>{t('crop.title')}</Title>
      <Text size="sm" c="dimmed">
        {t('crop.aspectRatio')}
      </Text>
      <SegmentedControl
        orientation="vertical"
        disabled={image === null}
        fullWidth
        value={cropRatio}
        onChange={handleRatioChange}
        data={aspectRatios(t)}
      />
        <Stack gap="xl">
          <Group>
            <Tooltip label={t('cropPanel.cropOrientation', { orientation: cropOrientation === 'portrait' ? t('crop.landscape') : t('crop.portrait') })}>
              <ActionIcon size='lg' variant='subtle' onClick={() => {setCropOrientation(cropOrientation === 'portrait' ? 'landscape' : 'portrait'); commit()}} disabled={image === null}>
                {cropOrientation === 'portrait' ? <IoMdPhonePortrait size="1.5rem" /> : <IoPhoneLandscapeSharp size="1.5rem" />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label={undefined}>
              <ActionIcon size='lg' variant='subtle' onClick={() => {}} disabled={image === null}>
                <MdOutlineGridGoldenratio size="1.5rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
          <OrientationComponent/>
          <RotationComponent/>
          <Stack gap={'sm'}>
            <Title order={5}>{t('masks.geometry')}</Title>
            <DistortionComponent/>
          </Stack>
        </Stack>
      </Stack>
  );
}
