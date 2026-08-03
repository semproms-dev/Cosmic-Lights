import { Slider, Stack, Title } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor } from '../../../editor/editorContext';

/**
 * Geometry tool controls: distortion, perspective, transform and offset
 * sliders. Owns only local preview state for now — wire each slider to the
 * editor store when the geometry transform pipeline exists.
 */
export function DistortionComponent() {
  const { t } = useTranslation(['common']);
  const [distortion, setDistortion] = useState(0);
  const [perspectiveVertical, setPerspectiveVertical] = useState(0);
  const [perspectiveHorizontal, setPerspectiveHorizontal] = useState(0);
  const [transformVertical, setTransformVertical] = useState(0);
  const [transformHorizontal, setTransformHorizontal] = useState(0);
  const [transformRotate, setTransformRotate] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const {image} = useEditor()

  return (
    <Stack gap="sm">
      <Title order={6}>{t('masks.distortion')}</Title>
      <Slider
        value={distortion}
        disabled={image === null}
        onChange={setDistortion}
        min={-100}
        max={100}
        thumbLabel={t('masks.distortion')}
      />

      <Title order={6}>{t('masks.perspective')}</Title>
      <Slider
        value={perspectiveVertical}
        disabled={image === null}
        onChange={setPerspectiveVertical}
        min={-100}
        max={100}
        thumbLabel={t('masks.perspective')}
      />
      <Slider
        value={perspectiveHorizontal}
        disabled={image === null}
        onChange={setPerspectiveHorizontal}
        min={-100}
        max={100}
        thumbLabel={t('masks.perspective')}
      />

      <Title order={6}>{t('masks.transform')}</Title>
      <Slider
        value={transformVertical}
        disabled={image === null}
        onChange={setTransformVertical}
        min={-100}
        max={100}
        thumbLabel={t('masks.transform')}
      />
      <Slider
        value={transformHorizontal}
        disabled={image === null}
        onChange={setTransformHorizontal}
        min={-100}
        max={100}
        thumbLabel={t('masks.transform')}
      />
      <Slider
        value={transformRotate}
        disabled={image === null}
        onChange={setTransformRotate}
        min={-100}
        max={100}
        thumbLabel={t('masks.transform')}
      />

      <Title order={6}>{t('masks.offset')}</Title>
      <Slider
        value={offsetX}
        disabled={image === null}
        onChange={setOffsetX}
        min={-100}
        max={100}
        thumbLabel={t('masks.offset')}
      />
      <Slider
        value={offsetY}
        disabled={image === null}
        onChange={setOffsetY}
        min={-100}
        max={100}
        thumbLabel={t('masks.offset')}
      />
    </Stack>
  );
}
