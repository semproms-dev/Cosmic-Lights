import { Accordion, Group, Stack, Text } from '@mantine/core';
import { basicAdjustments, colorAdjustement, detailsAdjustement } from '../../../editor/adjustments';
import { useEditor } from '../../../editor/editorContext';
import { ControlSlider } from './ControlSlider';
import { groupBy } from '../../../utils';

/**
 * Adjustments tool panel: Lightroom-style accordion of slider sections. Reads
 * and writes the live adjustment values through the shared editor store.
 */
export function AdjustmentsPanel() {
  const { adjustments, setAdjustment } = useEditor();
  const colorsByGroup = Object.entries(groupBy(colorAdjustement, i => i.group))

  return (
    <Accordion multiple defaultValue={['basic']}>
      <Accordion.Item value="basic">
        <Accordion.Control><Text fw={700}>Basic</Text></Accordion.Control>
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
        <Accordion.Control><Text fw={700}>Color</Text></Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            {colorsByGroup.map(([group, options]) => (
              <Group key={group}>
                <Text fw={500} size="sm">{group}</Text>
                {options.map((option) => (
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
              </Group>
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value='Details'>
        <Accordion.Control><Text fw={700}>Details</Text></Accordion.Control>
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
