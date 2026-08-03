import { Accordion, Button, Group, Stack, Text, Tooltip } from '@mantine/core';
import {
  basicAdjustments,
  colorAdjustement,
  detailsAdjustement,
  effectsAdjustement,
} from '../../../editor/adjustments';
import { useEditor } from '../../../editor/editorContext';
import { autoDenoiseSliders, denoiseSlidersFromNoise } from '../../../editor/noise';
import { ControlSlider } from './ControlSlider';
import { GradientSlider } from './GradientSlider';
import { CurvesPanel } from '../../panels/CurvesPanel/CurvesPanel';
import { groupBy } from '../../../utils';
import { useTranslation } from 'react-i18next';
import { GradingWheels } from './GradingWheels';


const TEMPERATURE_GRADIENT = 'linear-gradient(to right, #2690f0, #ffffff, #f5c542)';
const TINT_GRADIENT = 'linear-gradient(to right, #00FF00, #ffffff, #8A2BE2)'

/**
 * Adjustments tool panel: Lightroom-style accordion of slider sections. Reads
 * and writes the live adjustment values through the shared editor store.
 */
export function AdjustmentsPanel() {
  const { t } = useTranslation(['common']);
  const { adjustments, setAdjustment, commit, image } = useEditor();
  const colorsByGroup = Object.entries(groupBy(colorAdjustement, i => i.group))
  const detailsByGroup = Object.entries(groupBy(detailsAdjustement, i => i.group));
  // Auto denoise has two sources to work from: the shot's ISO (how noisy the
  // sensor should have been) and the noise measured from the pixels at load
  // time (how noisy the image actually is). Either one is enough — a JPEG
  // carries an ISO in its EXIF just as well as a RAW, and a file with no ISO
  // at all can still be measured. It is only when *neither* is available that
  // the button has nothing to propose.
  const iso = image?.metadata?.iso_speed ?? 0;
  const canAutoDenoise = iso > 0 || image?.noise != null;

  /**
   * Restores one slider to its default, for the click-the-label reset.
   *
   * Keyed by the adjustment's own `key` and its own `defaultValue`. The row
   * cannot work either out for itself: its label is translated (so "Exposición"
   * is not a key) and not every default is 0 (the vignette's midpoint and
   * feather rest at 50). Resetting is a discrete edit outside the slider's
   * `onChangeEnd`, so it takes its own checkpoint.
   */
  const resetOption = (option: { key: string; defaultValue: number }) => () => {
    setAdjustment(option.key, option.defaultValue);
    commit();
  };

  /**
   * Fills the three noise sliders from the measured noise and the ISO.
   *
   * When the image was measured at load, that measurement is the primary input:
   * it knows what the camera did between the sensor and the file, which the ISO
   * alone cannot. The ISO still shapes the result (a low ISO keeps the prior's
   * conservative dose, so fine texture is not mistaken for noise) — see
   * `denoiseSlidersFromNoise`. Without a measurement it falls back to the pure
   * ISO mapping.
   *
   * It writes the sliders rather than flipping a hidden "auto" flag, so the
   * result stays visible and draggable, and the single `commit()` at the end
   * makes the three writes one undo step instead of three.
   *
   * Guards on its own: the button is only *aria*-disabled (see below), so unlike
   * a natively disabled one it does fire this handler.
   */
  const applyAutoDenoise = () => {
    if (!image || !canAutoDenoise) return;
    const auto =
      image.noise != null
        ? denoiseSlidersFromNoise(image.noise, iso, image.source)
        : autoDenoiseSliders(iso, image.source);
    setAdjustment('colorNoise', auto.colorNoise);
    setAdjustment('luminanceNoise', auto.luminanceNoise);
    setAdjustment('luminanceDetail', auto.luminanceDetail);
    commit();
  };
  return (
    <Accordion multiple defaultValue={['basic']}>
      <Accordion.Item value="basic">
        <Accordion.Control><Text fw={700}>{t('groups.basic')}</Text></Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            {basicAdjustments.map((option) => (
              <ControlSlider
                key={option.key}
                label={t(`lateralNavBar.${option.key.toLowerCase()}`)}
                description={t(`labels.${option.key.toLowerCase()}`)}
                value={adjustments[option.key]}
                min={option.min}
                max={option.max}
                step={option.step}
                onChangeEnd={() => commit()}
                onChange={(value) => setAdjustment(option.key, value)}
                onReset={resetOption(option)}
              />
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value='Color'>
        <Accordion.Control><Text fw={700}>{t('groups.color')}</Text></Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            {colorsByGroup.map(([group, options]) => (
              <Stack key={group} gap="xs">
                <Text fw={500} size="sm">{t(`groups.${group}`)}</Text>
                {options.map((option) =>
                  option.key === 'temperature' || option.key === 'tint' ? (
                    <GradientSlider
                      key={option.key}
                      label={t(`lateralNavBar.${option.key}`)}
                      value={adjustments[option.key]}
                      min={option.min}
                      max={option.max}
                      step={option.step}
                      onChange={(value) => setAdjustment(option.key, value)}
                      onChangeEnd={() => commit()}
                      gradient={option.key === 'temperature' ? TEMPERATURE_GRADIENT : TINT_GRADIENT}
                    />
                  ) : (
                    <ControlSlider
                      key={option.key}
                      label={t(`lateralNavBar.${option.key}`)}
                      description={t(`labels.${option.key}`)}
                      value={adjustments[option.key]}
                      min={option.min}
                      max={option.max}
                      step={option.step}
                      onChangeEnd={() => commit()}
                      onChange={(value) => setAdjustment(option.key, value)}
                      onReset={resetOption(option)}
                    />
                  ),
                )}
              </Stack>
            ))}
            <Stack gap="xs">
              <Text fw={500} size="sm">{t('groups.grading')}</Text>
              <GradingWheels />
            </Stack>
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value='Details'>
        <Accordion.Control><Text fw={700}>{t('groups.details')}</Text></Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            {detailsByGroup.map(([group, options]) => (
              <Group key={group}>
                <Text fw={500} size="sm">{t(`groups.${group}`)}</Text>
                {options.map((option) => option.type === 'slider' ? (
                  <ControlSlider
                    key={option.key}
                    label={t(`lateralNavBar.${option.key}`)}
                    description={t(`labels.${option.key}`)}
                    value={adjustments[option.key]}
                    min={option.min}
                    max={option.max}
                    step={option.step}
                    onChangeEnd={() => commit()}
                    onChange={(value) => setAdjustment(option.key, value)}
                    onReset={resetOption(option)}
                  />
                ): (
                  // Disabled through ARIA rather than the `disabled` attribute, and
                  // that is the whole reason the tooltip works: a natively disabled
                  // button emits no pointer events, so the explanation of *why* it
                  // is unavailable would never reach the person who needs it. This
                  // way it stays focusable and hoverable — announced as unavailable,
                  // able to say so — with `data-disabled` doing the greying out and
                  // `applyAutoDenoise` refusing to act.
                  <Tooltip key={option.key} label={t('lateralNavBar.noAutoDenoise')} disabled={canAutoDenoise}>
                    <Button
                      data-disabled={!canAutoDenoise || undefined}
                      aria-disabled={!canAutoDenoise}
                      onClick={applyAutoDenoise}
                    >
                      {t('lateralNavBar.denoiseButton')}
                    </Button>
                  </Tooltip>

                ))}
                
              </Group>
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value='Effects'>
        <Accordion.Control><Text fw={700}>{t('groups.effects')}</Text></Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            {effectsAdjustement.map((option) => (
              <ControlSlider
                key={option.key}
                label={t(`lateralNavBar.${option.key}`)}
                description={t(`labels.${option.key}`)}
                value={adjustments[option.key]}
                min={option.min}
                max={option.max}
                step={option.step}
                onChangeEnd={() => commit()}
                onChange={(value) => setAdjustment(option.key, value)}
                onReset={resetOption(option)}
              />
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value='Curves'>
        <Accordion.Control><Text fw={700}>{t('groups.curves')}</Text></Accordion.Control>
        <Accordion.Panel>
          <CurvesPanel />
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
