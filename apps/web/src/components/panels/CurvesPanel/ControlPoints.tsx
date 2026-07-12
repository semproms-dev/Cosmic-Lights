import { useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { CurvePoint } from "../../../editor/curves";
import { clampToNeighbors, removePoint, valueToSvgX, valueToSvgY } from "../../../editor/curvesMath";

interface ControlPointsProps {
    points: CurvePoint[];
    size: number;
    onChange: (points: CurvePoint[]) => void;
    /** Checkpoints the current curve as one undo step (called on gesture end). */
    onCommit: () => void;
    /** Maps a pointer position to a curve value (owned by `CurveEditor`, which holds the SVG). */
    clientToValue: (clientX: number, clientY: number) => CurvePoint;
}

/** Control-point circle radius, in viewBox units. */
const POINT_RADIUS = 5;

/**
 * Draggable control points rendered over the curve. Presentational: drags,
 * additions via `clampToNeighbors` and removals via `removePoint` are all
 * reported through `onChange`. Endpoints are protected by the math helpers
 * (their x is locked and they cannot be removed), so no special-casing here.
 */
export const ControlPoints = ({ points, size, onChange, onCommit, clientToValue }: ControlPointsProps) => {
    const dragIndex = useRef<number | null>(null);

    const handlePointerDown = (index: number) => (event: ReactPointerEvent<SVGCircleElement>) => {
        // Stop the SVG's add-point handler from firing when grabbing a point.
        event.stopPropagation();
        dragIndex.current = index;
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: ReactPointerEvent<SVGCircleElement>) => {
        if (dragIndex.current === null) {
            return;
        }
        const next = clientToValue(event.clientX, event.clientY);
        onChange(clampToNeighbors(points, dragIndex.current, next));
    };

    const handlePointerUp = (event: ReactPointerEvent<SVGCircleElement>) => {
        dragIndex.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        // End of a drag: checkpoint it. A pointer-up with no move is a safe no-op
        // (the slice is unchanged, so COMMIT does nothing).
        onCommit();
    };

    const handleDoubleClick = (index: number) => (event: ReactMouseEvent<SVGCircleElement>) => {
        event.stopPropagation();
        onChange(removePoint(points, index));
        // Removing a point is a discrete edit: one undo step.
        onCommit();
    };

    return (
        <>
            {points.map((point, index) => (
                <circle
                    key={index}
                    cx={valueToSvgX(point.x, size)}
                    cy={valueToSvgY(point.y, size)}
                    r={POINT_RADIUS}
                    fill="var(--mantine-color-body)"
                    stroke="var(--mantine-color-blue-5)"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: "grab" }}
                    onPointerDown={handlePointerDown(index)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onDoubleClick={handleDoubleClick(index)}
                />
            ))}
        </>
    );
};
