import { Slider, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useEditor } from '../../../editor/editorContext';
import type { Geometry } from '../../../editor/geometry';

/**
 * Geometry tool controls: lens distortion, keystone perspective, per-axis scale
 * and offset. Every slider writes straight to the editor store, which folds them
 * into the composite pass' UV remap — no extra render pass, and the masks deform
 * along with the image because they are sampled through the same coordinates.
 *
 * The sliders are transient while dragging (`setGeometry` on every tick) and
 * commit once on release, so a drag is a single undo step rather than eighty.
 */
export function DistortionComponent() {
  const { t } = useTranslation(['common']);
  const { image, geometry, setGeometry, commit, angle, setRotationAngle } = useEditor();
  const disabled = image === null;

  /**
   * One geometry slider: the store is the only source of truth for its value.
   *
   * `label` doubles as the thumb label and as the caption above the track, and
   * it is omitted for a group that holds a single slider — repeating the section
   * title under itself reads as clutter, and it would put the same string on the
   * screen twice.
   */
  const control = (key: keyof Geometry, label: string, caption = true) => (
    <Stack gap={2} key={key}>
      {caption && <Text size="xs" c="dimmed">{label}</Text>}
      <Slider
        value={geometry[key]}
        disabled={disabled}
        onChange={(value: number) => setGeometry(key, value)}
        onChangeEnd={commit}
        min={-100}
        max={100}
        thumbLabel={label}
      />
    </Stack>
  );

  return (
    <Stack gap="sm">
      <Title order={6}>{t('masks.distortion')}</Title>
      {control('distortion', t('masks.distortion'), false)}

      <Title order={6}>{t('masks.perspective')}</Title>
      {control('perspectiveV', t('masks.axisVertical'))}
      {control('perspectiveH', t('masks.axisHorizontal'))}

      <Title order={6}>{t('masks.transform')}</Title>
      {control('scaleY', t('masks.axisVertical'))}
      {control('scaleX', t('masks.axisHorizontal'))}
      {/*
        Rotate is NOT a geometry slider: it is the same free-straighten angle
        RotationComponent shows, on the same −45..45 degrees. Giving Geometry its
        own rotation would put two controls on one value — they would disagree
        the moment either moved, and the second one to be dragged would silently
        win. One value, two views.
      */}

      <Title order={6}>{t('masks.offset')}</Title>
      {control('offsetX', t('masks.axisX'))}
      {control('offsetY', t('masks.axisY'))}
    </Stack>
  );
}
