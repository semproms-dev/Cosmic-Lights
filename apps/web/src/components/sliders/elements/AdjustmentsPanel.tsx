import { Accordion, Group, Stack, Text } from '@mantine/core';
import { basicAdjustments, colorAdjustement, detailsAdjustement, effectsAdjustement } from '../../../editor/adjustments';
import { useEditor } from '../../../editor/editorContext';
import { ControlSlider } from './ControlSlider';
import { GradientSlider } from './GradientSlider';
import { CurvesPanel } from '../../panels/CurvesPanel/CurvesPanel';
import { groupBy } from '../../../utils';
import { useTranslation } from 'react-i18next';

const TEMPERATURE_GRADIENT = 'linear-gradient(to right, #2690f0, #ffffff, #f5c542)';
const TINT_GRADIENT = 'linear-gradient(to right, #00FF00, #ffffff, #8A2BE2)'

/**
 * Adjustments tool panel: Lightroom-style accordion of slider sections. Reads
 * and writes the live adjustment values through the shared editor store.
 */
export function AdjustmentsPanel() {
  const { t } = useTranslation(['common']);
  const { adjustments, setAdjustment, commit } = useEditor();
  const colorsByGroup = Object.entries(groupBy(colorAdjustement, i => i.group))

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
              <Group key={group}>
                <Text fw={500} size="sm">{group}</Text>
                {options.map((option) =>
                  (option.key === 'temperature' || option.key === 'tint') ? (
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
              </Group>
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value='Details'>
        <Accordion.Control><Text fw={700}>{t('groups.details')}</Text></Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
              {detailsAdjustement.map((option) => (
              <ControlSlider
                key={option.key}
                label={option.label}
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
