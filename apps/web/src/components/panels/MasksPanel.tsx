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
  IconCanary
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
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useEditor } from '../../editor/editorContext'
import { basicAdjustments, colorAdjustement, detailsAdjustement } from '../../editor/adjustments'
import {
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
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
import { useContextMenu } from 'mantine-contextmenu'
import { formatConfidence, speciesDisplayName } from '../../editor/birds/identifyBird'

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
  { type: 'identify', labelKey: 'detectSubject', icon: IconCanary}
]

/**
 * Whether a mask is still waiting for the user to say what to select. Only the
 * promptable object mask can be in this state: it is created empty and segments
 * nothing until the first click on the canvas.
 */
function awaitingPrompt(mask: Mask): boolean {
  return mask.type === 'object' && (mask.prompt === null || isPromptEmpty(mask.prompt))
}

/**
 * Masks tool panel: recreates Lightroom's "Add New Mask" menu, lists the current
 * masks and — for the selected mask — exposes its local adjustment sliders, plus
 * the brush settings when the mask is painted by hand.
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
    commit,
    setMaskOverlayHidden,
    maskStatus,
    modelProgress,
    retryMask,
    birdSpecies,
    birdStatus,
  } = useEditor()

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

  return (
    <Stack gap="sm" p="xs">
      <Text fw={700} size="sm">{t('masks.addNew')}</Text>
      <Stack gap={2}>
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
                  <UnstyledButton
                    onClick={() => setActiveMask(mask.id)}
                    style={{ flex: 1, padding: '4px 8px', borderRadius: 'var(--mantine-radius-sm)', minWidth: 0 }}
                    data-active={mask.id === activeMaskId || undefined}
                  >
                    <Text onContextMenu={showContextMenu(
                      [
                        {
                          key: 'duplicateandinvert',
                          icon: <IconDumpling size="1.5rem" />,
                          title: t('masks.contextDuplicateInvert'),
                          onClick: () => {
                            // Only the selection is copied. Carrying the tone
                            // changes over would spread them across the whole
                            // frame, since the two masks are complements.
                            duplicateMask(mask.id, `${mask.name} ${t('masks.copySuffix')}`, {
                              invert: !mask.invert,
                              resetAdjustments: true,
                            });
                            commit();
                          }
                        },
                        {
                          key: 'delete',
                          icon: <IconTrash size="1.5rem" />,
                          title: t('masks.contextRemoveMask'),
                          onClick: () => {removeMask(mask.id); commit();}
                        },
                        {
                          key: 'duplicate',
                          icon: <IconCopy size="1.5rem" />,
                          title: t('masks.contextDuplicate'),
                          onClick: () => {
                            // No invert override: a plain copy keeps whatever the
                            // original was set to.
                            duplicateMask(mask.id, `${mask.name} ${t('masks.copySuffix')}`);
                            commit();
                          }
                        }
                      ]
                    )} size="sm" fw={mask.id === activeMaskId ? 700 : 400} truncate>{mask.name}
                  </Text>
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
          {active.type === 'identify' && (
            // The whole point of this mask type: it paints nothing, so its
            // result has to be *read* here or it may as well not have run.
            <Stack gap={4}>
              {birdStatus === 'loading' && (
                <Group gap="xs">
                  <Loader size="xs" />
                  <Text size="xs" c="dimmed">{t('masks.speciesSearching')}</Text>
                </Group>
              )}
              {birdStatus === 'ready' && birdSpecies !== null && (
                <>
                  {/* Italic, and never translated: it is a scientific name. */}
                  <Text size="sm" fs="italic">{speciesDisplayName(birdSpecies.label)}</Text>
                  <Text size="xs" c="dimmed">
                    {t('masks.speciesConfidence', {
                      value: formatConfidence(birdSpecies.confidence),
                    })}
                  </Text>
                  <Text size='sm'>{birdSpecies.description}</Text>
                </>
              )}
              {/* An answer ("no bird in this photo"), worded as such… */}
              {birdStatus === 'ready' && birdSpecies === null && (
                <Text size="xs" c="dimmed">{t('masks.speciesNone')}</Text>
              )}
              {/* …and a failure, which must not be mistaken for the above: the
                  service being down says nothing about what is in the photo. */}
              {birdStatus === 'error' && (
                <Group gap="xs" wrap="nowrap">
                  <Text size="xs" c="red">{t('masks.speciesError')}</Text>
                  <Tooltip label={t('masks.speciesRetry')}>
                    <ActionIcon
                      variant="subtle"
                      color="yellow"
                      aria-label={t('masks.speciesRetry')}
                      onClick={() => retryMask(active.id)}
                    >
                      <IconRefresh size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              )}
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
                onChange={(value) => setBrush({ mode: value as BrushMode })}
                data={[
                  { value: 'add', label: t('masks.brushAdd') },
                  { value: 'erase', label: t('masks.brushErase') },
                ]}
              />
              <Group justify="space-between" gap="xs">
                <Text size="sm">{t('masks.brushSize')}</Text>
                <Text size="sm" c="dimmed">{Math.round(brush.size * 100)}</Text>
              </Group>
              <Slider
                value={brush.size}
                onChange={(v) => setBrush({ size: v })}
                min={BRUSH_SIZE_MIN}
                max={BRUSH_SIZE_MAX}
                step={0.005}
                label={null}
                thumbLabel={t('masks.brushSize')}
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
          {/* An identify mask never gets an alpha, so its sliders would move
              with nothing to apply them to — dead controls that read as broken
              rather than as "not for this tool". */}
          {active.type !== 'identify' && (
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
          )}
        </>
      )}
    </Stack>
  )
}
