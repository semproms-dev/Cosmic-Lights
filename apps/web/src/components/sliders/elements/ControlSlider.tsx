import { Group, Slider, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import classes from '../styles/ControlSlider.module.css';
import { useHover, useWindowEvent } from '@mantine/hooks';
import { useEditor } from '../../../editor/editorContext';
import { IconInfoCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { usePreferences } from '../../../preferences/preferences';
import { roundAccurate } from '../../../utils';
import { useState } from 'react';

interface ControlSliderProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onChangeEnd?: () => void;
  /**
   * Restores the control's default. Given by the owner, which is the only place
   * that knows *which* value this row writes and what its default is — the label
   * cannot say, since it is translated.
   *
   * Omit it (as the export quality slider does) and the label is inert: a row
   * that resets nothing is better than one that resets the wrong thing.
   */
  onReset?: () => void;
}

/**
 * A single labelled adjustment row: the control's name, its current value, a
 * Mantine `Slider` and a compact numeric `TextInput` for typing an exact value.
 * The slider is fully controlled; the input keeps a local string mirror of the
 * value so partial or invalid text is safe to type, committing the parsed,
 * clamped number back through `onChange` on Enter or blur.
 */
export function ControlSlider({
  label,
  description,
  value,
  min,
  max,
  step,
  onChange,
  onChangeEnd,
  onReset,
}: ControlSliderProps) {
  const { hovered, ref } = useHover();
  const { image } = useEditor();
  const { t } = useTranslation(['common']);
  const { preferences } = usePreferences();
  const showReset = hovered && onReset !== undefined;
  const [prevValue, setPrevValue] = useState(value);
  const [inputValue, setInputValue] = useState(String(roundAccurate(value)));
  const [focused, setFocused] = useState(false);
  const [input, setInput] = useState(false);

  useWindowEvent('keydown', (event) => {
    if(!input || event.key !== 'Escape') return;
    setInputValue(String(roundAccurate(value)));
    setInput(false);
  })

  /**
   * Keeps the typed text in step with the slider. The input mirrors an external
   * value (drag, reset, auto-denoise), so the mirror must follow it. Adjusting
   * state during render is the React-endorsed alternative to a `useEffect` that
   * calls `setState`: React re-renders with the fresh prop before the browser
   * paints, so the text never shows a stale value for a frame.
   *
   * While the input is focused the sync stands down: the user's own keystrokes
   * are the only writer, and a committed value echoing back would fight text
   * that is not yet a complete number (a trailing dot, a leading minus).
   */
  if (!focused && prevValue !== value) {
    setPrevValue(value);
    setInputValue(String(roundAccurate(value)));
  }

  /**
   * Applies the typed number through `onChange` so the preview moves the moment
   * the text changes. Blur or Enter mark the end of the gesture: then the value
   * also gets its single undo checkpoint (`onChangeEnd`) and the text is
   * normalised to the clamped number. While typing, invalid text is left alone
   * instead of being reverted mid-keystroke.
   */
  const commitInput = (text: string, checkpoint: boolean) => {
    const parsed = Number(text);
    if (Number.isNaN(parsed) || text.trim() === '') {
      if (checkpoint) setInputValue(String(roundAccurate(value)));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    const rounded = roundAccurate(clamped);
    if (rounded !== value) {
      onChange(rounded);
      if (checkpoint) onChangeEnd?.();
    }
    if (checkpoint) setInputValue(String(rounded));
  };

  /**
   * Steps the committed value by ±0.01, clamped to the range. Shared by the
   * `TextInput` and the focusable value readout so both answer the arrow keys.
   */
  const nudge = (direction: 1 | -1) => {
    const stepped = Math.min(max, Math.max(min, value + direction * 0.01));
    // Rounding keeps repeated presses from showing float noise
    // (0.05 + 0.01 prints as "0.060000000000000005").
    commitInput(String(roundAccurate(stepped)), true);
  };

  return (
    <Stack gap={4} className={classes.control}>
      {/*
        `nowrap` because Mantine's default lets the value drop to a line of its
        own once the label stops fitting, which is what the grading rows do:
        their labels are two keys concatenated ("Altas luces Luminosidad"), the
        longest in the app, and in a rail this narrow they overrun. The value
        must stay pinned to the right of its label, so it is the label that
        gives way — see `.label`, which wraps onto a second line instead.
      */}
      <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
         <Group gap={6} wrap="nowrap" align="flex-start" className={classes.labelGroup}>
         {preferences.helper ?
          <Tooltip label={description ?? label}>
              <IconInfoCircle size="1rem" stroke={2} color="var(--mantine-color-dimmed)"  />
            </Tooltip>: null
          }
          {/*
            Both texts stay in the DOM, stacked in one grid cell, and only their
            visibility swaps. Replacing the text outright is what caused the
            label to flicker: "Reset" is shorter than most labels, so the element
            shrank out from under the pointer, the hover went false, the long
            label came back under the pointer, and round it went. Sharing a cell
            keeps the box as wide as the wider of the two, whatever is showing.
            The visibility is inline rather than a class so that jsdom — which
            never applies the stylesheet — can still see which one is showing.
          */}
          <Text
            size="sm"
            className={classes.label}
            onClick={onReset}
            style={{ cursor: onReset === undefined ? 'default' : 'pointer' }}
            ref={ref}
          >
            <span style={{ visibility: showReset ? 'hidden' : 'visible' }}>{label}</span>
            <span style={{ visibility: showReset ? 'visible' : 'hidden' }}>{t('common.reset')}</span>
          </Text>
        </Group> 
        {/*
          Readout and input are both mounted, stacked in one grid cell, and only
          their visibility swaps — the same arrangement as the label above, for
          the same reason. Swapping one for the other could not be made to hold
          still: the input is a different size from the text, so whichever was
          showing set the row's height and the slider moved under it. Sharing a
          cell sizes the row to the taller of the two, and the CSS then flattens
          the input down to a single line so that taller *is* the text.

          `visibility` is inline, and whichever is hidden also carries
          `aria-hidden`, so the one not showing leaves the accessibility tree:
          otherwise every row would offer two controls under the same name, and
          jsdom — which never applies the stylesheet — would find both.
        */}
        <div className={classes.value}>
          <TextInput
            variant="unstyled"
            size="sm"
            classNames={{ input: classes.valueInput }}
            style={{ visibility: input ? 'visible' : 'hidden' }}
            aria-hidden={input ? undefined : true}
            aria-label={label}
            disabled={image === null}
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.currentTarget.value);
              commitInput(event.currentTarget.value, false);
            }}
            onFocus={() => setFocused(true)}
            onBlur={(event) => {
              setFocused(false);
              commitInput(event.currentTarget.value, true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitInput(event.currentTarget.value, true);
                event.currentTarget.blur();
              }
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                nudge(event.key === 'ArrowUp' ? 1 : -1);
              }

              if (event.key === 'Escape') {
                // Cancel the edit: discard the typed text without committing and
                // close the input. Escape must not be an undo-point, so no
                // `commitInput` here.
                setInputValue(String(roundAccurate(value)));
                setInput(false);
              }
            }}
          />
          <Text
            size="sm"
            c="dimmed"
            ta="right"
            role="spinbutton"
            aria-hidden={input ? true : undefined}
            aria-label={label}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            // Hidden, it must also leave the tab order, or a Tab through the
            // panel would stop on a readout nobody can see.
            tabIndex={image === null || input ? -1 : 0}
            style={{ visibility: input ? 'hidden' : 'visible', cursor: 'pointer' }}
            onClick={() => {
              // Re-seed the mirror from the committed value on open, so a
              // cancelled edit never shows up next time the input appears.
              setInputValue(String(roundAccurate(value)));
              setInput(!input);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                nudge(event.key === 'ArrowUp' ? 1 : -1);
              }
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setInputValue(String(roundAccurate(value)));
                setInput(true);
              }
            }}
          >
            {roundAccurate(value)}
          </Text>
        </div>
      </Group>
      <Slider
        value={value}
        onChange={onChange}
        disabled={image === null}
        onChangeEnd={onChangeEnd}
        min={min}
        max={max}
        step={step}
        label={null}
        thumbLabel={label}
      />
    </Stack>
  );
}
