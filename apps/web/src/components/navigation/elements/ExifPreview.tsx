import { Group, Stack, Text } from '@mantine/core'
import type { Metadata } from 'libraw-wasm'
import { useTranslation } from 'react-i18next'
import { formatAperture, formatShutterSpeed } from '../../../utils'

interface ExifPreviewProps {
  metadata: Metadata | null
  loading?: boolean
  file: File | undefined
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="sm" ta="right">{value}</Text>
    </Group>
  )
}

function formatFileSize(bytes: number, locale: string) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unitIndex = 0

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex += 1
    }

    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`
}

/** Readable summary of the selected image's EXIF, with the full data available on demand. */
export function ExifPreview({ metadata, loading = false, file }: ExifPreviewProps) {
    const { t, i18n } = useTranslation(['common'])
    const locale = i18n.resolvedLanguage ?? i18n.language
    const fileSize = file ? formatFileSize(file.size, locale) : null

    if (loading) {
        return (
            <Stack gap="xs">
                <Text size="sm" c="dimmed">{t('directoryPreview.metadataLoading')}</Text>
                {fileSize && <MetadataRow label={t('directoryPreview.fileSize')} value={fileSize} />}
            </Stack>
        )
    }

    if (!metadata) {
        return (
            <Stack gap="xs">
                <Text size="sm" c="dimmed">{t('directoryPreview.metadataEmpty')}</Text>
                {fileSize && <MetadataRow label={t('directoryPreview.fileSize')} value={fileSize} />}
            </Stack>
        )
    }

    const camera = [metadata.camera_make, metadata.camera_model]
        .filter(Boolean)
        .join(' ') || '—'

    const hasCaptureDate =
        metadata.timestamp instanceof Date &&
        Number.isFinite(metadata.timestamp.getTime()) &&
        metadata.timestamp.getTime() !== 0
    const captureDate = hasCaptureDate
        ? new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(metadata.timestamp)
        : '—'

    const exposure = [
        metadata.shutter > 0 ? formatShutterSpeed(metadata.shutter) : null,
        metadata.aperture > 0 ? formatAperture(metadata.aperture) : null,
        metadata.focal_len > 0 ? `${metadata.focal_len} mm` : null,
        metadata.iso_speed > 0 ? `ISO ${metadata.iso_speed}` : null,
    ].filter(Boolean).join(' · ') || '—'

    const dimensions = metadata.width > 0 && metadata.height > 0
        ? `${metadata.width} × ${metadata.height} px`
        : '—';

    const artist = metadata.artist === "" ? '—' : metadata.artist;

    return (
        <Stack gap="xs">
            <Text fw={600}>{t('directoryPreview.metadataTitle')}</Text>
            <MetadataRow label={t('directoryPreview.camera')} value={camera} />
            <MetadataRow label={t('directoryPreview.exposure')} value={exposure} />
            <MetadataRow label={t('directoryPreview.captureDate')} value={captureDate} />
            <MetadataRow label={t('directoryPreview.dimensions')} value={dimensions} />
            <MetadataRow label={t('directoryPreview.artist')} value={artist}/>
            {fileSize && <MetadataRow label={t('directoryPreview.fileSize')} value={fileSize} />}
        </Stack>
    )
}
