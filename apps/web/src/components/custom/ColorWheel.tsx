import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { useHover } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';
import { handlePosition, hueSatFromPointer } from './colorWheelMath';
import classes from './ColorWheel.module.css';

/** Default diameter in px. Three of these fit a 320px panel side by side. */
const DEFAULT_SIZE = 76;

/** Degrees of hue one arrow key travels. */
const HUE_STEP = 5;

/** Points of saturation one arrow key travels. */
const SAT_STEP = 5;

/** Lightness the wheel paints at. The wheel picks a tint, not a brightness. */
const WHEEL_LIGHTNESS = 50;

interface ColorWheelProps {
  /** Visible name of the zone this wheel tints, already translated. */
  label: string;
  /** Current hue in degrees, 0..360. */
  hue: number;
  /** Current saturation, 0..100. 0 means the zone is untinted. */
  saturation: number;
  /** Reports every change while dragging, like a slider's `onChange`. */
  onChange: (hue: number, saturation: number) => void;
  /** Called once the gesture ends, so the owner can checkpoint one undo step. */
  onChangeEnd?: () => void;
  /**
   * Restores the wheel's neutral. Given by the owner, which is the only place
   * that knows which keys this wheel writes — the label cannot say, since it is
   * translated. Omit it and the label is inert.
   */
  onReset?: () => void;
  /** Diameter in px. Also the radius the pointer maths works from. */
  size?: number;
  /** Greys the wheel out and ignores pointer and keyboard alike. */
  disabled?: boolean;
}

/**
 * A colour-grading wheel: hue around the rim, saturation from centre to edge.
 *
 * Controlled and presentational — it owns no colour of its own, so presets,
 * undo/redo and a reset all move it, which an inner `useState` copy would not
 * notice. Its lightness is fixed: the wheel picks a *tint*, and how bright the
 * zone is stays the tone sliders' business.
 */
export function ColorWheel({
  label,
  hue,
  saturation,
  onChange,
  onChangeEnd,
  onReset,
  size = DEFAULT_SIZE,
  disabled = false,
}: ColorWheelProps) {
  const { t } = useTranslation(['common']);
  const { hovered, ref: labelRef } = useHover();
  const wheelRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const radius = size / 2;

  /**
   * Turns a pointer position into hue and saturation.
   *
   * The radius comes from the `size` prop rather than from measuring the node:
   * on the very first render the ref is still null, and a measured-too-late
   * radius put the handle in the wrong place until something else re-rendered.
   * Only the wheel's origin is read off the DOM.
   */
  const updateFromPointer = useCallback(
    (event: PointerEvent | React.PointerEvent<HTMLDivElement>) => {
      if (!wheelRef.current) return;
      const rect = wheelRef.current.getBoundingClientRect();
      const next = hueSatFromPointer(
        event.clientX - (rect.left + radius),
        event.clientY - (rect.top + radius),
        radius,
      );

      onChange(next.hue, next.saturation);
    },
    [onChange, radius],
  );

  // The gesture is followed on the window, not on the wheel: let go of it and
  // the pointer routinely ends up outside a 76px circle, and listeners bound to
  // the element would drop the drag halfway through.
  useEffect(() => {
    if (!dragging) return;

    const handleMove = (event: PointerEvent) => updateFromPointer(event);
    const handleUp = () => {
      setDragging(false);
      onChangeEnd?.();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragging, onChangeEnd, updateFromPointer]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    setDragging(true);
    updateFromPointer(event);
  };

  /**
   * Keyboard equivalent of the drag: left/right walk the hue round the rim, up
   * and down move in and out of the centre. Each press is a finished edit, so it
   * checkpoints on its own.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let nextHue = hue;
    let nextSaturation = saturation;

    switch (event.key) {
      case 'ArrowRight':
        nextHue = (hue + HUE_STEP) % 360;
        break;
      case 'ArrowLeft':
        nextHue = (hue - HUE_STEP + 360) % 360;
        break;
      case 'ArrowUp':
        nextSaturation = Math.min(100, saturation + SAT_STEP);
        break;
      case 'ArrowDown':
        nextSaturation = Math.max(0, saturation - SAT_STEP);
        break;
      default:
        return;
    }

    event.preventDefault();
    onChange(nextHue, nextSaturation);
    onChangeEnd?.();
  };

  const position = handlePosition(hue, saturation, radius);
  const showReset = hovered && onReset !== undefined && !disabled;

  return (
    <Stack gap={2} align="center">
      <div
        ref={wheelRef}
        role="group"
        aria-label={label}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className={`${classes.wheel} ${disabled ? classes.disabled : ''}`}
        style={{ width: size, height: size }}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      >
        <div
          className={classes.handle}
          style={{
            left: position.x,
            top: position.y,
            backgroundColor: `hsl(${hue}, ${saturation}%, ${WHEEL_LIGHTNESS}%)`,
          }}
        />
      </div>
      {/*
        Both texts stay in the DOM and only their visibility swaps — see
        `ControlSlider`, which has the same label and had the same flicker: a
        label that shrinks into "Reset" pulls its own box out from under the
        pointer, and the hover oscillates.
      */}
      <Text
        size="xs"
        className={classes.label}
        ref={labelRef}
        onClick={disabled ? undefined : onReset}
        style={{ cursor: onReset === undefined || disabled ? 'default' : 'pointer' }}
      >
        <span style={{ visibility: showReset ? 'hidden' : 'visible' }}>{label}</span>
        <span style={{ visibility: showReset ? 'visible' : 'hidden' }}>{t('common.reset')}</span>
      </Text>
      <Text size="xs" c="dimmed">
        {hue}° · {saturation}
      </Text>
    </Stack>
  );
}
