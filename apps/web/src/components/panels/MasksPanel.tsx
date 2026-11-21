import {
  IconBrush,
  IconCircleDot,
  IconClick,
  IconLine,
  IconRefresh,
  IconTrash,
  IconUser,
  IconDumpling,
  IconCopy,
  IconEdit
} from '@tabler/icons-react'
import {
  ActionIcon,
  Divider,
  Group,
  Loader,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useEditor } from '../../editor/editorContext'
import { basicAdjustments, colorAdjustement, detailsAdjustement } from '../../editor/adjustments'
import {
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  BRUSH_SIZE_SLIDER_STEP,
  isPromptEmpty,
  MASK_ADJUSTMENT_KEYS,
  MASK_GRANULARITIES,
  MAX_MASKS,
  promptGranularity,
  withPromptGranularity,
  type BrushMode,
  type Mask,
  type MaskGranularity,
  type MaskType,
} from '../../editor/masks'
import { useContextMenu, type ContextMenuItemOptions } from 'mantine-contextmenu'

/**
 * Slider metadata (label/range/step) for every mask-adjustment key. `details` is
 * in here for `texture`, which a mask may carry even though the mask pass cannot
 * apply it — it reaches the composite through the amount map instead.
 */
const ADJ_META = new Map(
  [...basicAdjustments, ...colorAdjustement, ...detailsAdjustement].map((o) => [o.key, o]),
)

/** One "Add New Mask" entry. Disabled entries are the not-yet-built tools. */
interface AddOption {
  type: MaskType | null
  /** Key under the `masks` i18n namespace. */
  labelKey: string
  icon: typeof IconBrush
  disabled?: boolean
}

const ADD_OPTIONS: AddOption[] = [
  { type: 'subject', labelKey: 'selectSubject', icon: IconUser },
  { type: 'brush', labelKey: 'brush', icon: IconBrush },
  { type: 'linear', labelKey: 'linearGradient', icon: IconLine },
  { type: 'radial', labelKey: 'radialGradient', icon: IconCircleDot },
  { type: 'object', labelKey: 'selectObject', icon: IconClick },
]

interface MaskOption {
  key: string
  icon: typeof IconBrush
  titleKey: string
}

const CONTEXT_MENU_MASKS: MaskOption[] = [
  { key: 'duplicateandinvert', icon: IconDumpling, titleKey: 'contextDuplicateInvert' },
  { key: 'delete', icon: IconTrash, titleKey: 'contextRemoveMask' },
  { key: 'duplicate', icon: IconCopy, titleKey: 'contextDuplicate' },
  { key: 'edit', icon: IconEdit, titleKey: 'edit' },
]

/**
 * Whether a mask is still waiting for the user to say what to select. Only the
 * promptable object mask can be in this state: it is created empty and segments
 * nothing until the first click on the canvas.
 */
function awaitingPrompt(mask: Mask): boolean {
  return mask.type === 'object' && (mask.prompt === null || isPromptEmpty(mask.prompt))
}

interface BrushSizeSliderProps {
  size: number
  label: string
  onChange: (size: number) => void
}

/** Brush-size control shared by hand-painted masks and AI-mask refinements. */
function BrushSizeSlider({ size, label, onChange }: BrushSizeSliderProps): ReactElement {
  return (
    <>
      <Group justify="space-between" gap="xs">
        <Text size="sm">{label}</Text>
        <Text size="sm" c="dimmed">{Math.round(size * 100)}</Text>
      </Group>
      <Slider
        value={size}
        onChange={onChange}
        min={BRUSH_SIZE_MIN}
        max={BRUSH_SIZE_MAX}
        step={BRUSH_SIZE_SLIDER_STEP}
        label={null}
        thumbLabel={label}
      />
    </>
  )
}

/**
 * Masks tool panel: recreates Lightroom's "Add New Mask" menu, lists the current
 * masks and — for the selected mask — exposes its local adjustment sliders, plus
 * the brush settings for hand-painted masks and Select Subject refinements.
 *
 * Each row carries a right-click menu for the per-mask operations that do not
 * deserve permanent buttons: duplicating it (with or without flipping its
 * invert) and removing it.
 *
 * Brush, Subject, both gradients and the promptable object mask are wired; the
 * range tools are not built yet and have no entry.
 */
export function MasksPanel() {
  const { t } = useTranslation()
  const {
    image,
    masks,
    activeMaskId,
    addMask,
    duplicateMask,
    removeMask,
    setActiveMask,
    setMaskAdjustment,
    setObjectPrompt,
    brush,
    setBrush,
    setBrushArmedMask,
    commit,
    setMaskOverlayHidden,
    maskStatus,
    modelProgress,
    retryMask,
    renameMask,
  } = useEditor()

  const [editingMaskId, setEditingMaskId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const skipBlurRef = useRef(false)

  const disabled = image === null
  const atCap = masks.length >= MAX_MASKS
  const { showContextMenu } = useContextMenu();
  const active = masks.find((m) => m.id === activeMaskId) ?? null
  // A mask with no alpha yet has nothing to adjust: its sliders would silently
  // do nothing, which reads as a broken control rather than as "not ready".
  // An object mask that has never been prompted is in exactly that state without
  // ever having had a status, so it has to be asked separately.
  const activeBusy = active !== null && (
    (maskStatus.get(active.id) !== undefined && maskStatus.get(active.id) !== 'ready')
    || awaitingPrompt(active)
  )

  const handleBrushModeChange = (value: string): void => {
    if (active === null) return
    setBrush({ mode: value as BrushMode })
    setBrushArmedMask(active.id)
  }

  const startRename = (mask: Mask): void => {
    skipBlurRef.current = false
    setEditingMaskId(mask.id)
    setDraftName(mask.name)
  }

  const finishRename = (mask: Mask): void => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false
      setEditingMaskId(null)
      return
    }
    const name = draftName.trim()
    if (name !== '' && name !== mask.name) renameMask(mask.id, name)
    setEditingMaskId(null)
  }

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>, mask: Mask): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      finishRename(mask)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      skipBlurRef.current = true
      setEditingMaskId(null)
    }
  }

  const handleMaskMenuAction = (key: string, mask: Mask): void => {
    switch (key) {
      case 'duplicateandinvert':
        // Only the selection is copied. Carrying the tone
        // changes over would spread them across the whole
        // frame, since the two masks are complements.
        duplicateMask(mask.id, `${mask.name} ${t('masks.copySuffix')}`, {
          invert: !mask.invert,
          resetAdjustments: true,
        })
        commit()
        break
      case 'delete':
        removeMask(mask.id)
        commit()
        break
      case 'duplicate':
        // No invert override: a plain copy keeps whatever the
        // original was set to.
        duplicateMask(mask.id, `${mask.name} ${t('masks.copySuffix')}`)
        commit()
        break
      case 'edit':
        setActiveMask(mask.id)
        startRename(mask)
        break
    }
  }

  const maskContextMenu = (mask: Mask): ContextMenuItemOptions[] =>
    CONTEXT_MENU_MASKS.map((option) => {
      const Icon = option.icon
      return {
        key: option.key,
        icon: <Icon size="1.5rem" />,
        title: t(`masks.${option.titleKey}`),
        onClick: () => handleMaskMenuAction(option.key, mask),
      }
    })

  return (
    <Stack gap="sm" p="xs">
      <Text fw={700} size="sm">{t('masks.addNew')}</Text>
      <Stack gap={2}>
        {atCap ? <Text c="red" fw={700}>{t('masks.limitReached', { max: MAX_MASKS })}</Text> : null}
        {ADD_OPTIONS.map((opt) => (
            <UnstyledButton
              key={opt.labelKey}
              disabled={disabled || opt.disabled || opt.type === null || atCap}
              onClick={() => opt.type !== null && addMask(opt.type)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 'var(--mantine-radius-sm)',
                opacity: disabled || opt.disabled || atCap ? 0.4 : 1,
                cursor: disabled || opt.disabled || atCap ? 'not-allowed' : 'pointer',
              }}
            >
              <opt.icon size="1.125rem" stroke={1.5} />
              <Text size="sm">{t(`masks.${opt.labelKey}`)}</Text>
            </UnstyledButton>
        ))}
      </Stack>

      {masks.length > 0 && (
        <>
          <Divider label={t('masks.title')} labelPosition="left" />
          <Stack gap={2}>
            {masks.map((mask) => {
              const status = maskStatus.get(mask.id)
              return (
                <Group key={mask.id} justify="space-between" gap="xs" wrap="nowrap">
                  {editingMaskId === mask.id ? (
                    <TextInput
                      size="xs"
                      autoFocus
                      value={draftName}
                      aria-label={t('masks.edit')}
                      onChange={(event) => setDraftName(event.currentTarget.value)}
                      onBlur={() => finishRename(mask)}
                      onKeyDown={(event) => handleRenameKeyDown(event, mask)}
                      style={{ flex: 1 }}
                    />
                  ) : (
                    <UnstyledButton
                      onClick={() => setActiveMask(mask.id)}
                      style={{ flex: 1, padding: '4px 8px', borderRadius: 'var(--mantine-radius-sm)', minWidth: 0 }}
                      data-active={mask.id === activeMaskId || undefined}
                    >
                      <Text
                        onDoubleClick={() => startRename(mask)}
                        onContextMenu={showContextMenu(maskContextMenu(mask))}
                        size="sm"
                        fw={mask.id === activeMaskId ? 700 : 400}
                        truncate
                      >{mask.name}</Text>
                      {status === 'loading' && (
                        // The two waits look identical to the user but are not: the
                        // download is slow once and has a real percentage, while
                        // inference is slow every time and has nothing to report.
                        <Text size="xs" c="dimmed">
                          {modelProgress === null
                            ? t('masks.segmenting')
                            : t('masks.downloadingModel', { progress: Math.round(modelProgress) })}
                        </Text>
                      )}
                      {status === 'error' && (
                        <Text size="xs" c="red">{t('masks.segmentFailed')}</Text>
                      )}
                    </UnstyledButton>
                  )}
                  {status === 'loading' && <Loader size="xs" />}
                  {status === 'error' && (
                    <Tooltip label={t('masks.retry')}>
                      <ActionIcon
                        variant="subtle"
                        color="yellow"
                        aria-label={t('masks.retry')}
                        onClick={() => retryMask(mask.id)}
                      >
                        <IconRefresh size="1rem" />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <ActionIcon variant="subtle" color="red" aria-label={`Delete ${mask.name}`} onClick={() => { removeMask(mask.id); commit() }}>
                    <IconTrash size="1rem" />
                  </ActionIcon>
                </Group>
              )
            })}
          </Stack>
        </>
      )}

      {active !== null && (
        <>
          <Divider label={active.name} labelPosition="left" />
          {awaitingPrompt(active) && (
            // Nothing on screen would otherwise say that this mask is waiting on
            // the canvas, not on the model: it has no status, no spinner and its
            // controls are disabled.
            <Text size="xs" c="dimmed">{t('masks.objectHint')}</Text>
          )}
          {active.type === 'object' && !awaitingPrompt(active) && active.prompt !== null && (
            // One click means three things at once (the eye, the face, the
            // person) and SAM's confidence does not rank them by intent, so the
            // reading is the user's to pick. Changing it re-decodes against the
            // cached embedding — cheap, no re-encoding of the image.
            <Stack gap={4}>
              <Text size="xs" c="dimmed">{t('masks.granularity')}</Text>
              <SegmentedControl
                size="xs"
                fullWidth
                value={promptGranularity(active.prompt)}
                onChange={(value) => {
                  const prompt = active.prompt
                  if (prompt === null) return
                  setObjectPrompt(active.id, withPromptGranularity(prompt, value as MaskGranularity))
                  commit()
                }}
                data={MASK_GRANULARITIES.map((option) => ({
                  value: option,
                  label: t(`masks.granularity${option.charAt(0).toUpperCase()}${option.slice(1)}`),
                }))}
              />
            </Stack>
          )}
          {active.type === 'brush' && (
            // Tool settings, not mask settings: they seed the *next* stroke and
            // leave the strokes already painted exactly as they are.
            <Stack gap={6}>
              <SegmentedControl
                size="xs"
                fullWidth
                value={brush.mode}
                onChange={handleBrushModeChange}
                data={[
                  { value: 'add', label: t('masks.brushAdd') },
                  { value: 'erase', label: t('masks.brushErase') },
                ]}
              />
              <BrushSizeSlider
                size={brush.size}
                label={t('masks.brushSize')}
                onChange={(size) => setBrush({ size })}
              />
              <Group justify="space-between" gap="xs">
                <Text size="sm">{t('masks.brushHardness')}</Text>
                <Text size="sm" c="dimmed">{Math.round(brush.hardness * 100)}</Text>
              </Group>
              <Slider
                value={brush.hardness}
                onChange={(v) => setBrush({ hardness: v })}
                min={0}
                max={1}
                step={0.05}
                label={null}
                thumbLabel={t('masks.brushHardness')}
              />
            </Stack>
          )}
          {
            active.type === 'subject' && (
              <Stack gap={6}>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={brush.mode}
                  onChange={handleBrushModeChange}
                  data={[
                    { value: 'add', label: t('masks.brushAdd') },
                    { value: 'erase', label: t('masks.brushErase') },
                  ]}
                />
                <BrushSizeSlider
                  size={brush.size}
                  label={t('masks.brushSize')}
                  onChange={(size) => setBrush({ size })}
                />
              </Stack>
            )
          }
          <Stack gap="md">
            {MASK_ADJUSTMENT_KEYS.map((key) => {
              const meta = ADJ_META.get(key)
              if (meta === undefined) return null
              const label = t(`lateralNavBar.${key}`)
              return (
                <Stack key={key} gap={4}>
                  <Group justify="space-between" gap="xs">
                    <Text size="sm">{label}</Text>
                    <Text size="sm" c="dimmed">{active.adjustments[key]}</Text>
                  </Group>
                  <Slider
                    value={active.adjustments[key]}
                    disabled={activeBusy}
                    onChange={(v) => {
                      // Hide the red overlay while dragging so the change shows.
                      setMaskOverlayHidden(true)
                      setMaskAdjustment(active.id, key, v)
                    }}
                    onChangeEnd={() => {
                      setMaskOverlayHidden(false)
                      commit()
                    }}
                    min={meta.min}
                    max={meta.max}
                    step={meta.step}
                    label={null}
                    thumbLabel={label}
                  />
                </Stack>
              )
            })}
          </Stack>
        </>
      )}
    </Stack>
  )
}
