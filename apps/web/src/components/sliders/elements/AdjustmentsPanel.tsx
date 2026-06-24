import { Accordion, Stack } from '@mantine/core';
import { basicAdjustments, colorAdjustement, detailsAdjustement } from '../../../editor/adjustments';
import { useEditor } from '../../../editor/editorContext';
import { ControlSlider } from './ControlSlider';

/**
 * Adjustments tool panel: Lightroom-style accordion of slider sections. Reads
 * and writes the live adjustment values through the shared editor store.
 */
export function AdjustmentsPanel() {
  const { adjustments, setAdjustment } = useEditor();

  return (
    <Accordion multiple defaultValue={['basic']}>
      <Accordion.Item value="basic">
        <Accordion.Control>Basic</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            {basicAdjustments.map((option) => (
              <ControlSlider
                key={option.key}
                label={option.label}
                value={adjustments[option.key]}
                min={option.min}
                max={option.max}
                step={option.step}
                onChange={(value) => setAdjustment(option.key, value)}
              />
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value='Color'>
        <Accordion.Control>Color</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            {colorAdjustement.map((option) => (
              <ControlSlider
                key={option.key}
                label={option.label}
                value={adjustments[option.key]}
                min={option.min}
                max={option.max}
                step={option.step}
                onChange={(value) => setAdjustment(option.key, value)}
              />
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value='Details'>
        <Accordion.Control>Details</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            {detailsAdjustement.map((option) => (
              <ControlSlider
                key={option.key}
                label={option.label}
                value={adjustments[option.key]}
                min={option.min}
                max={option.max}
                step={option.step}
                onChange={(value) => setAdjustment(option.key, value)}
              />
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
