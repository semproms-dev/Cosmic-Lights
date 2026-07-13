import {
  IconBrush,
  IconCircleDot,
  IconCloud,
  IconColorSwatch,
  IconContrast,
  IconLine,
  IconMountain,
  IconTrash,
  IconUser,
} from '@tabler/icons-react'
import {
  ActionIcon,
  Divider,
  Group,
  Slider,
  Stack,
  Switch,
  Text,
  UnstyledButton,
} from '@mantine/core'
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
  label: string
  icon: typeof IconBrush
  disabled?: boolean
}

const ADD_OPTIONS: AddOption[] = [
  { type: 'subject', label: 'Select Subject', icon: IconUser },
  { type: 'sky', label: 'Select Sky', icon: IconCloud },
  { type: 'brush', label: 'Brush', icon: IconBrush },
  { type: null, label: 'Linear Gradient', icon: IconLine, disabled: true },
  { type: null, label: 'Radial Gradient', icon: IconCircleDot, disabled: true },
  { type: null, label: 'Color Range', icon: IconColorSwatch, disabled: true },
  { type: null, label: 'Luminance Range', icon: IconContrast, disabled: true },
  { type: null, label: 'Depth Range', icon: IconMountain, disabled: true },
]

/**
 * Masks tool panel: recreates Lightroom's "Add New Mask" menu, lists the current
 * masks and — for the selected mask — exposes its local adjustment sliders and
 * an invert toggle. Brush/Subject/Sky are wired; the gradient and range tools
 * are shown disabled until they are built.
 */
export function MasksPanel() {
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
  } = useEditor()

  const disabled = image === null
  const atCap = masks.length >= MAX_MASKS
  const active = masks.find((m) => m.id === activeMaskId) ?? null

  return (
    <Stack gap="sm" p="xs">
      <Text fw={700} size="sm">Add New Mask</Text>
      <Stack gap={2}>
        {ADD_OPTIONS.map((opt) => (
          <UnstyledButton
            key={opt.label}
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
            <Text size="sm">{opt.label}</Text>
          </UnstyledButton>
        ))}
      </Stack>

      {masks.length > 0 && (
        <>
          <Divider label="Masks" labelPosition="left" />
          <Stack gap={2}>
            {masks.map((mask) => (
              <Group key={mask.id} justify="space-between" gap="xs" wrap="nowrap">
                <UnstyledButton
                  onClick={() => setActiveMask(mask.id)}
                  style={{ flex: 1, padding: '4px 8px', borderRadius: 'var(--mantine-radius-sm)' }}
                  data-active={mask.id === activeMaskId || undefined}
                >
                  <Text size="sm" fw={mask.id === activeMaskId ? 700 : 400}>{mask.name}</Text>
                </UnstyledButton>
                <ActionIcon variant="subtle" color="red" aria-label={`Delete ${mask.name}`} onClick={() => { removeMask(mask.id); commit() }}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        </>
      )}

      {active !== null && (
        <>
          <Divider label={active.name} labelPosition="left" />
          <Switch
            label="Invert"
            checked={active.invert}
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
