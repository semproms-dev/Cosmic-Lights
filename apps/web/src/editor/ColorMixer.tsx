import { Box, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { COLORS } from '../utils';
import { GradientSlider } from "../components/sliders/elements/GradientSlider";
import { useEditor } from "./editorContext";
import { colorMixerAdjustment } from "./adjustments";


export default function ColorMixer() {
    const { t } = useTranslation(['common']);
    const { adjustments, setAdjustment, commit } = useEditor();
    const [activeId, setActiveId] = useState('mixYellow');

    const active = COLORS.filter((c) => c.id === activeId)[0];
    const activeOption = colorMixerAdjustment.filter((o) => o.key === activeId)[0];

    const renderSlider = (label: string, gradientName: string, key: string, gradient: string, value: number) => (
        <GradientSlider
            onChange={(value) => setAdjustment(key, value)}
            min={-100}
            max={100}
            gradient={gradient}
            gradientName={gradientName}
            label={label}
            value={value}
            step={1}
            onChangeEnd={() => commit()}
            onReset={() => {
                setAdjustment(key, 0);
                commit();
            }}
        />
    )

    return (
        <Stack gap={'lg'}>
            <Text fw={500} size="sm">{t('lateralNavBar.colorMixer')}</Text>
            <Group justify="space-between" wrap="nowrap" w="100%">
                {COLORS.map((c) => {
                    const isActive = activeId === c.id;
                    return (
                        <Group flex={1} justify="center" key={c.id}>
                            <UnstyledButton
                                onClick={() => setActiveId(c.id)}
                                style={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: '50%',
                                    border: `2px solid ${c.hex}`,
                                    position: 'relative',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                                >
                                {isActive && (
                                <Box w={8} h={8} style={{ borderRadius: '50%', backgroundColor: c.hex }} />
                                )}
                            </UnstyledButton>
                        </Group>
                    )
            })}                
            </Group>
            <Stack gap="xs">
                {renderSlider(t('labels.hue'), t('lateralNavBar.hue'), activeOption.hueKey, active.hueGradient, adjustments[activeOption.hueKey])}
                {renderSlider(t('labels.luminosity'), t('lateralNavBar.luminance'), activeOption.lumKey, active.lumGradient, adjustments[activeOption.lumKey])}
                {renderSlider(t('labels.saturation'), t('lateralNavBar.saturation'), activeOption.satKey, active.satGradient, adjustments[activeOption.satKey])}
            </Stack>
        </Stack>
    )
}
