import { useState } from 'react'
import { IconFolder, IconChevronDown } from '@tabler/icons-react'
import { Box, Collapse, Image, Stack, Text, UnstyledButton } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useEditor } from '../../editor/editorContext'
import type { ImageState } from '../../editor/image'
import { BUILTIN_PRESETS, groupPresets, type Preset, type PresetKind } from '../../editor/presets'
import { usePresetThumbnails } from '../../editor/usePresetThumbnails'

/**
 * Catálogo repartido en carpetas, calculado una vez a nivel de módulo: el
 * catálogo de fábrica no cambia, y `BUILTIN_PRESETS` tiene que llegar al hook de
 * miniaturas como una referencia estable o su efecto se relanzaría en cada
 * render.
 */
const GROUPS = groupPresets(BUILTIN_PRESETS)

/**
 * Panel de presets: recetas de revelado repartidas en carpetas plegables por
 * familia (estilo, color, blanco y negro, luz y cine), cada una previsualizada
 * sobre la foto abierta.
 *
 * Aplicar un preset **reemplaza** el revelado global — los sliders que no nombra
 * vuelven a su valor por defecto — para que el resultado sea exactamente el de
 * la miniatura, venga uno del estado que venga. El recorte, la orientación y las
 * máscaras no se tocan: son trabajo sobre *esta* foto, no parte de la receta.
 */
export function Presets() {
    const { t } = useTranslation();
    const {image, applyPreset, commit} = useEditor();
    const thumbnails = usePresetThumbnails(BUILTIN_PRESETS, image);
    const [collapsed, setCollapsed] = useState<Set<PresetKind>>(new Set());

    // Resaltado puramente visual, emparejado con la foto a la que se aplicó:
    // abrir otra imagen resetea los ajustes (`SET_IMAGE`), así que arrastrar el
    // resaltado a la foto nueva señalaría un preset que ya no está puesto.
    // Deshacer sí lo deja desfasado; es el precio de no meterlo en el historial.
    const [applied, setApplied] = useState<{ source: ImageState; id: string } | null>(null)
    const appliedId = applied !== null && applied.source === image ? applied.id : null

    const disabled = image === null

    const toggle = (group: PresetKind): void => {
        setCollapsed((current) => {
        const next = new Set(current)
        if (next.has(group)) next.delete(group)
        else next.add(group)
        return next
        })
    }

    const apply = (preset: Preset): void => {
        if (disabled) return
        applyPreset(preset)
        setApplied({ source: image, id: preset.id })
        // Un preset entero es un paso de deshacer, no doce.
        commit()
    }

    return(
        <Stack gap={'sm'} p={'xs'}>
            {disabled && <Text size="xs" c="dimmed">{t('presets.empty')}</Text>}
             {[...GROUPS].map(([group, presets]) => (
        <Stack key={group} gap={6}>
          <UnstyledButton
            onClick={() => toggle(group)}
            // La carpeta es un disclosure: sin esto, un lector de pantalla
            // anuncia un botón sin decir si lo que hay debajo está abierto.
            aria-expanded={!collapsed.has(group)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 'var(--mantine-radius-md)',
              background: 'var(--mantine-color-dark-6)',
            }}
          >
            <IconFolder size={16} stroke={1.5} />
            <Text size="sm" fw={600} tt="uppercase" style={{ flex: 1 }}>
              {t(`presets.kind.${group}`)}
            </Text>
            <Text size="xs" c="dimmed">{presets.length}</Text>
            <IconChevronDown
              size={14}
              stroke={1.5}
              style={{
                transform: collapsed.has(group) ? 'rotate(-90deg)' : 'none',
                transition: 'transform 150ms ease',
              }}
            />
          </UnstyledButton>

          <Collapse expanded={!collapsed.has(group)}>
            <Stack gap={6} pl={6}>
              {presets.map((preset) => (
                <UnstyledButton
                  key={preset.id}
                  disabled={disabled}
                  onClick={() => apply(preset)}
                  aria-label={t('presets.apply', { name: preset.name })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 6,
                    borderRadius: 'var(--mantine-radius-md)',
                    background: 'var(--mantine-color-dark-7)',
                    outline: preset.id === appliedId
                      ? '1px solid var(--mantine-primary-color-filled)'
                      : '1px solid transparent',
                    opacity: disabled ? 0.4 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {/* Caja fija con `cover`: retratos y apaisados dan filas de la
                      misma altura sin deformar la foto. */}
                  <Box w={72} h={48} style={{ borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--mantine-color-dark-5)' }}>
                    {thumbnails.has(preset.id) && (
                      <Image src={thumbnails.get(preset.id)} w={72} h={48} fit="cover" alt="" />
                    )}
                  </Box>
                  {/* La familia ya la dice la carpeta que contiene la fila, así
                      que el nombre se queda solo. */}
                  <Text size="sm" fw={600} truncate style={{ minWidth: 0 }}>{preset.name}</Text>
                </UnstyledButton>
              ))}
            </Stack>
          </Collapse>
        </Stack>
      ))}
    </Stack>
    )

}