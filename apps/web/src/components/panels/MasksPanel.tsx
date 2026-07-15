import {
  IconBrush,
  IconCircleDot,
  IconCloud,
  IconColorSwatch,
  IconContrast,
  IconLine,
  IconMountain,
  IconRefresh,
  IconTrash,
  IconUser,
} from '@tabler/icons-react'
import {
  ActionIcon,
  Divider,
  Group,
  Loader,
  Slider,
  Stack,
  Switch,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useEditor } from '../../editor/editorContext'
import { basicAdjustments, colorAdjustement } from '../../editor/adjustments'
import { MASK_ADJUSTMENT_KEYS, MAX_MASKS, type MaskType } from '../../editor/masks'

/** Slider metadata (label/range/step) for every mask-adjustment key. */
const ADJ_META = new Map(
  [...basicAdjustments, ...colorAdjustement].map((o) => [o.key, o]),
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
  { type: null, labelKey: 'linearGradient', icon: IconLine, disabled: true },
  { type: null, labelKey: 'radialGradient', icon: IconCircleDot, disabled: true },
  { type: null, labelKey: 'colorRange', icon: IconColorSwatch, disabled: true },
  { type: null, labelKey: 'luminanceRange', icon: IconContrast, disabled: true },
  { type: null, labelKey: 'depthRange', icon: IconMountain, disabled: true },
]

/**
 * Masks tool panel: recreates Lightroom's "Add New Mask" menu, lists the current
 * masks and — for the selected mask — exposes its local adjustment sliders and
 * an invert toggle. Brush/Subject/Sky are wired; the gradient and range tools
 * are shown disabled until they are built.
 */
export function MasksPanel() {
  const { t } = useTranslation()
  const {
    image,
    masks,
    activeMaskId,
    addMask,
    removeMask,
    setActiveMask,
    setMaskAdjustment,
    setMaskInvert,
    commit,
    setMaskOverlayHidden,
    maskStatus,
    modelProgress,
    retryMask,
  } = useEditor()

  const disabled = image === null
  const atCap = masks.length >= MAX_MASKS
  const active = masks.find((m) => m.id === activeMaskId) ?? null
  // A mask with no alpha yet has nothing to adjust: its sliders would silently
  // do nothing, which reads as a broken control rather than as "not ready".
  const activeBusy = active !== null && maskStatus.get(active.id) !== undefined
    && maskStatus.get(active.id) !== 'ready'

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
            <opt.icon size={18} stroke={1.5} />
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
                    <Text size="sm" fw={mask.id === activeMaskId ? 700 : 400} truncate>{mask.name}</Text>
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
                        <IconRefresh size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <ActionIcon variant="subtle" color="red" aria-label={`Delete ${mask.name}`} onClick={() => { removeMask(mask.id); commit() }}>
                    <IconTrash size={16} />
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
          <Switch
            label={t('masks.invert')}
            checked={active.invert}
            disabled={activeBusy}
            onChange={(e) => { setMaskInvert(active.id, e.currentTarget.checked); commit() }}
          />
          <Stack gap="md">
            {MASK_ADJUSTMENT_KEYS.map((key) => {
              const meta = ADJ_META.get(key)
              if (meta === undefined) return null
              return (
                <Stack key={key} gap={4}>
                  <Group justify="space-between" gap="xs">
                    <Text size="sm">{meta.label}</Text>
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
                    thumbLabel={meta.label}
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
