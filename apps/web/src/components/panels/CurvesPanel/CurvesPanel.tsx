import { useState } from "react";
import { Button, Stack } from "@mantine/core";
import { IDENTITY_CURVE, type ChannelId } from "../../../editor/curves";
import { useEditor } from "../../../editor/editorContext";
import { ChannelTabs } from "./ChannelTabs";
import { CurveEditor } from "./CurveEditor";

/** Editor canvas side, in curve-value units (0..255 viewBox). */
const EDITOR_SIZE = 256;

/**
 * Tone-curve tool panel. Owns the active channel and is the only piece that
 * talks to the editor store: it reads the active channel's control points and
 * pushes edits back through `setCurve`. Its children stay presentational.
 */
export const CurvesPanel = () => {
    const { curves, setCurve, commit, image } = useEditor();
    const [channel, setChannel] = useState<ChannelId>("rgb");

    const points = curves[channel];
    const disabled = image === null;

    const handleReset = () => {
        // Per-channel reset: deep-copy the identity so a later drag can't mutate
        // the shared IDENTITY_CURVE constant.
        setCurve(channel, IDENTITY_CURVE.map((p) => ({ ...p })));
        // Checkpoint the reset as one undo step.
        commit();
    };

    return (
        <Stack gap={"sm"}>
            <ChannelTabs value={channel} onChange={setChannel} disabled={disabled} />
            <CurveEditor
                points={points}
                size={EDITOR_SIZE}
                onChange={(next) => setCurve(channel, next)}
                onCommit={commit}
                disabled={disabled}
            />
            <Button variant="subtle" onClick={handleReset} disabled={disabled}>
                Reset channel
            </Button>
        </Stack>
    );
};
