import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { CurvePoint } from "../../../editor/curves";
import { clamp } from "../../../utils";
import {
    compileLut,
    insertPoint,
    svgToValueX,
    svgToValueY,
    valueToSvgX,
    valueToSvgY,
} from "../../../editor/curvesMath";
import { ControlPoints } from "./ControlPoints";

interface CurveEditorProps {
    points: CurvePoint[];
    size: number;
    onChange: (points: CurvePoint[]) => void;
    /** Checkpoints the current curve as one undo step (called on gesture end). */
    onCommit: () => void;
}

/** Quarter positions for the reference grid (¼, ½, ¾ of the canvas). */
const GRID_FRACTIONS = [0.25, 0.5, 0.75];

/**
 * Presentational SVG canvas for the tone curve. Renders the reference grid, the
 * identity diagonal and the compiled curve, and hosts the draggable control
 * points. Clicking empty space adds a point that lands on the current curve.
 * Owns no state — every edit is reported through `onChange`.
 */
export const CurveEditor = ({ points, size, onChange, onCommit }: CurveEditorProps) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const lut = useMemo(() => compileLut(points), [points]);

    const curvePath = useMemo(
        () =>
            lut
                .map((y, x) => `${x === 0 ? "M" : "L"} ${valueToSvgX(x, size)} ${valueToSvgY(y, size)}`)
                .join(" "),
        [lut, size],
    );

    /** Converts a pointer event to a curve value, correcting for the SVG's on-screen scale. */
    const clientToValue = (clientX: number, clientY: number): CurvePoint => {
        const svg = svgRef.current;
        if (svg === null) {
            return { x: 0, y: 0 };
        }
        const rect = svg.getBoundingClientRect();
        const svgX = ((clientX - rect.left) / rect.width) * size;
        const svgY = ((clientY - rect.top) / rect.height) * size;
        return { x: svgToValueX(svgX, size), y: svgToValueY(svgY, size) };
    };

    /** Empty-space click: add a point on the curve at the clicked x (y read from the LUT). */
    const handleAddPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
        const { x } = clientToValue(event.clientX, event.clientY);
        const roundedX = Math.round(clamp(x, 0, 255));
        onChange(insertPoint(points, { x: roundedX, y: lut[roundedX] }));
        // Adding a point is a discrete edit: one undo step.
        onCommit();
    };

    return (
        <svg
            ref={svgRef}
            viewBox={`0 0 ${size} ${size}`}
            onPointerDown={handleAddPoint}
            style={{
                width: "100%",
                aspectRatio: "1 / 1",
                borderRadius: "var(--mantine-radius-sm)",
                border: "1px solid var(--mantine-color-default-border)",
                background: "var(--mantine-color-body)",
                touchAction: "none",
            }}
        >
            {/* Reference grid */}
            {GRID_FRACTIONS.map((f) => (
                <g key={f} stroke="var(--mantine-color-default-border)" strokeWidth={1} vectorEffect="non-scaling-stroke">
                    <line x1={f * size} y1={0} x2={f * size} y2={size} />
                    <line x1={0} y1={f * size} x2={size} y2={f * size} />
                </g>
            ))}

            {/* Identity diagonal (Y is flipped, so it rises to the right) */}
            <line
                x1={0}
                y1={size}
                x2={size}
                y2={0}
                stroke="var(--mantine-color-dimmed)"
                strokeWidth={1}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
            />

            {/* The compiled curve */}
            <path
                d={curvePath}
                fill="none"
                stroke="var(--mantine-color-blue-5)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
            />

            <ControlPoints points={points} size={size} onChange={onChange} onCommit={onCommit} clientToValue={clientToValue} />
        </svg>
    );
};
