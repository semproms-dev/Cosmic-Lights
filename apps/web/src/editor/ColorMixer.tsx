import { Box, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import { GradientSlider } from "../components/sliders/elements/GradientSlider";
import { useEditor } from "./editorContext";
import { colorMixerAdjustment } from "./adjustments";

const COLORS = [
    { 
        id: 'mixRed', 
        hex: '#FF3B30', 
        hueGradient: 'linear-gradient(to right, hsl(260, 50%, 50%), hsl(0, 50%, 50%), hsl(100, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(0, 0%, 50%), hsl(0, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(0, 100%, 0%), hsl(0, 100%, 50%), hsl(0, 100%, 100%))'
    },
    { 
        id: 'mixOrange', 
        hex: '#FF9500', 
        hueGradient: 'linear-gradient(to right, hsl(290, 50%, 50%), hsl(30, 50%, 50%), hsl(130, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(30, 0%, 50%), hsl(30, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(30, 100%, 0%), hsl(30, 100%, 50%), hsl(30, 100%, 100%))'
    },
    { 
        id: 'mixYellow', 
        hex: '#FFCC00', 
        hueGradient: 'linear-gradient(to right, hsl(320, 50%, 50%), hsl(60, 50%, 50%), hsl(160, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(60, 0%, 50%), hsl(60, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(60, 100%, 0%), hsl(60, 100%, 50%), hsl(60, 100%, 100%))'
    },
    { 
        id: 'mixGreen', 
        hex: '#34C759', 
        hueGradient: 'linear-gradient(to right, hsl(20, 50%, 50%), hsl(120, 50%, 50%), hsl(220, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(120, 0%, 50%), hsl(120, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(120, 100%, 0%), hsl(120, 100%, 50%), hsl(120, 100%, 100%))'
    },
    { 
        id: 'mixCyan', 
        hex: '#32ADE6', 
        hueGradient: 'linear-gradient(to right, hsl(80, 50%, 50%), hsl(180, 50%, 50%), hsl(280, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(180, 0%, 50%), hsl(180, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(180, 100%, 0%), hsl(180, 100%, 50%), hsl(180, 100%, 100%))'
    },
    { 
        id: 'mixBlue', 
        hex: '#007AFF', 
        hueGradient: 'linear-gradient(to right, hsl(140, 50%, 50%), hsl(240, 50%, 50%), hsl(340, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(240, 0%, 50%), hsl(240, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(240, 100%, 0%), hsl(240, 100%, 50%), hsl(240, 100%, 100%))'
    },
    { 
        id: 'mixPurple', 
        hex: '#AF52DE', 
        hueGradient: 'linear-gradient(to right, hsl(200, 50%, 50%), hsl(300, 50%, 50%), hsl(40, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(285, 0%, 50%), hsl(285, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(285, 100%, 0%), hsl(285, 100%, 50%), hsl(285, 100%, 100%))'
    },
    { 
        id: 'mixMagenta', 
        hex: '#FF2D55', 
        hueGradient: 'linear-gradient(to right, hsl(240, 50%, 50%), hsl(340, 50%, 50%), hsl(80, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(315, 0%, 50%), hsl(315, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(315, 100%, 0%), hsl(315, 100%, 50%), hsl(315, 100%, 100%))'
    },
];

export default function ColorMixer() {
    const { adjustments, setAdjustment, commit } = useEditor();
    const [activeId, setActiveId] = useState('mixYellow');

    const active = COLORS.filter((c) => c.id === activeId)[0];
    const activeOption = colorMixerAdjustment.filter((o) => o.key === activeId)[0];

    const renderSlider = (label: string, key: string, gradient: string, value: number) => (
        <GradientSlider
            onChange={(value) => setAdjustment(key, value)}
            min={-100}
            max={100}
            gradient={gradient}
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
            <Text fw={500} size="sm">Color Mixer</Text>
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
                {renderSlider("Hue", activeOption.hueKey, active.hueGradient, adjustments[activeOption.hueKey])}
                {renderSlider("Luminance", activeOption.lumKey, active.lumGradient, adjustments[activeOption.lumKey])}
                {renderSlider("Saturation", activeOption.satKey, active.satGradient, adjustments[activeOption.satKey])}
            </Stack>
        </Stack>
    )
}
