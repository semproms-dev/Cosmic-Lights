import { SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { useEditor } from '../../../editor/editorContext';
import { useTranslation } from 'react-i18next';
import { DistortionComponent } from './DistortionComponent';
import { OrientationComponent } from './OrientationComponent';
import { RotationComponent } from './RotationComponent';

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
  const { cropRatio, setCropRatio, commit, image } = useEditor();
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
