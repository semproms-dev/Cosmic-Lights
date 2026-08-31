import { Group, SegmentedControl, Select, Stack, Text, Title } from '@mantine/core';
import { useEditor, type CropOverlayType } from '../../../editor/editorContext';
import type { CropOrientation } from '../../../editor/editorReducer';
import { useTranslation } from 'react-i18next';
import { DistortionComponent } from './DistortionComponent';
import { OrientationComponent } from './OrientationComponent';
import { RotationComponent } from './RotationComponent';
import { CropValues } from '../../../utils';

const aspectRatios = (t: (key: string) => string) => [
  { value: 'Original', label: t('crop.original') },
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '3:2', label: '3:2' },
  { value: '5:4', label: '5:4' },
  { value: 'Free', label: t('crop.free') },
];

const orientationOptions = (t: (key: string) => string) => [
  { value: 'landscape', label: t('crop.landscape') },
  { value: 'portrait', label: t('crop.portrait') },
];

const overlayOptions = (t: (key: string) => string) =>
  CropValues.map((value) => ({ value, label: t(`cropOverlay.${value}`) }));

/**
 * Crop tool panel. Exposes the aspect-ratio selector, wired to the shared editor
 * store so the crop overlay can constrain the draft to the chosen ratio.
 */
export function CropPanel() {
  const { cropRatio, setCropRatio, commit, setCropOrientation, image, cropOrientation, cropOverlay, setCropOverlay } = useEditor();
  const {t} = useTranslation(['common']);

  // Picking a ratio is a discrete edit: apply it, then checkpoint it as one undo step.
  const handleRatioChange = (value: string) => {
    setCropRatio(value);
    commit();
  };

  const handleOverlayChange = (value: string | null) => {
    setCropOverlay((value ?? 'thirds') as CropOverlayType);
    commit();
  };

  const handleOrientationChange = (value: string | null) => {
    setCropOrientation((value === 'portrait' ? 'portrait' : 'landscape') as CropOrientation);
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
            <Select
              label={t('cropPanel.orientationLabel')}
              data={orientationOptions(t)}
              value={cropOrientation}
              onChange={handleOrientationChange}
              allowDeselect={false}
              disabled={image === null}
              w={150}
            />
            <Select
              label={t('cropPanel.overlayLabel')}
              data={overlayOptions(t)}
              value={cropOverlay ?? 'thirds'}
              onChange={handleOverlayChange}
              allowDeselect={false}
              disabled={image === null}
              w={150}
            />
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
