import { SimpleGrid, Stack } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  gradingAdjustement,
  GRADING_DEFAULT_HUE,
  GRADING_DEFAULT_LUM,
  GRADING_DEFAULT_SAT,
  GRADING_LUM_RANGE,
  type GradingOption,
} from '../../../editor/adjustments';
import { useEditor } from '../../../editor/editorContext';
import { ColorWheel } from '../../custom/ColorWheel';
import { ControlSlider } from './ControlSlider';

/**
 * Colour grading: a wheel per tonal zone in a row, and their luminance sliders
 * stacked full width underneath.
 *
 * The wheels go side by side because grading is a comparison — what the shadows
 * are tinted towards only means something next to where the highlights went — and
 * because stacked they would take some 450px of a 320px-wide panel. The
 * luminances do NOT: squeezed into a 60px column each, one pixel of drag was
 * worth four points of the range, so they get the panel's full width and the
 * standard slider row, value readout and click-to-reset included.
 *
 * Each zone is one idea but three adjustment keys, so the writing lives here,
 * next to the {@link GradingOption} that names them, rather than inside the
 * controls.
 */
export function GradingWheels() {
  const { t } = useTranslation(['common']);
  const { adjustments, setAdjustment, commit, image } = useEditor();

  /**
   * Restores one zone to its neutral: tint and brightness alike.
   *
   * Three writes, one checkpoint. The wheel and its slider are separate controls
   * to the hand but one zone to the eye, and a reset that left the zone half
   * graded would be a reset in name only.
   */
  const resetWheel = (option: GradingOption) => () => {
    setAdjustment(option.hueKey, GRADING_DEFAULT_HUE);
    setAdjustment(option.satKey, GRADING_DEFAULT_SAT);
    setAdjustment(option.lumKey, GRADING_DEFAULT_LUM);
    commit();
  };

  /** Restores one zone's brightness, leaving its tint alone. */
  const resetLuminance = (option: GradingOption) => () => {
    setAdjustment(option.lumKey, GRADING_DEFAULT_LUM);
    commit();
  };

  return (
    <Stack gap="sm">
      <SimpleGrid cols={3} spacing="xs" verticalSpacing="xs">
        {gradingAdjustement.map((option) => (
          <ColorWheel
            key={option.key}
            label={t(`lateralNavBar.${option.key}`)}
            hue={adjustments[option.hueKey]}
            saturation={adjustments[option.satKey]}
            onChange={(hue, saturation) => {
              setAdjustment(option.hueKey, hue);
              setAdjustment(option.satKey, saturation);
            }}
            // One checkpoint per gesture, like the sliders: a commit per pointer
            // move would fill the undo history with a single drag.
            onChangeEnd={() => commit()}
            onReset={resetWheel(option)}
            disabled={image === null}
          />
        ))}
      </SimpleGrid>
      <Stack gap="xs">
        {gradingAdjustement.map((option) => (
          <ControlSlider
            key={option.key}
            // Named per zone, not just "Luminance": the panel already has a
            // Luminance (noise reduction) and a Shadows (tone), and three rows
            // sharing either name would be ambiguous to a screen reader and to
            // anyone reading the panel top to bottom.
            label={`${t(`lateralNavBar.${option.key}`)} ${t('lateralNavBar.gradeLum')}`}
            description={t('labels.gradeLum')}
            value={adjustments[option.lumKey]}
            min={-GRADING_LUM_RANGE}
            max={GRADING_LUM_RANGE}
            step={1}
            onChange={(value) => setAdjustment(option.lumKey, value)}
            onChangeEnd={() => commit()}
            onReset={resetLuminance(option)}
          />
        ))}
      </Stack>
    </Stack>
  );
}
