import { useRef, useState, type ChangeEvent } from 'react'
import { ActionIcon, Menu, Text, Tooltip } from '@mantine/core'
import { useModals } from '@mantine/modals'
import { IconFileExport, IconFileImport, IconFileSettings } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useEditor } from '../../../editor/editorContext'
import {
  createCopiedDevelop,
  parseDevelopFile,
  serializeDevelopFile,
  type DevelopFile,
} from '../../../editor/developClipboard'
import { logger } from '../../../logger'
import { ConfirmDialog } from '../../window/ConfirmDialog'

/** Refuse absurdly large files before parsing them as JSON. */
const MAX_DEVELOP_FILE_BYTES = 1024 * 1024

/** Turns `photo.arw` into `photo-settings.json`. */
function settingsFileName(sourceName: string): string {
  const base = sourceName.replace(/\.[^.]+$/, '') || 'cosmiclights'
  return `${base}-settings.json`
}

/**
 * Writes the JSON to disk, using the File System Access API when available and
 * falling back to a download link otherwise.
 */
async function saveDevelopFile(text: string, fileName: string): Promise<void> {
  const blob = new Blob([text], { type: 'application/json' })

  try {
    if (typeof window.showSaveFilePicker === 'function') {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{
          description: 'CosmicLights develop settings',
          accept: { 'application/json': ['.json'] },
        }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    }

    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    throw error
  }
}

/**
 * Toolbar menu that exports the current global develop as JSON and imports a
 * previously exported file. Importing always asks for confirmation because it
 * replaces the develop of the open photo.
 */
export function DevelopFileMenu() {
  const { image, imageDirty, adjustments, curves, applyDevelop } = useEditor()
  const { t } = useTranslation(['common'])
  const modals = useModals()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<DevelopFile | null>(null)
  const [pendingFileName, setPendingFileName] = useState('')

  const openImportError = (message: string): void => {
    modals.openModal({
      modalId: 'develop-import-error',
      title: t('topNav.importSettingsErrorTitle'),
      children: <Text size="sm">{message}</Text>,
    })
  }

  const handleExport = async (): Promise<void> => {
    if (image === null) return

    try {
      const develop = createCopiedDevelop(adjustments, curves, image)
      const text = serializeDevelopFile(develop, __APP_VERSION__)
      await saveDevelopFile(text, settingsFileName(image.fileName))
    } catch (error) {
      logger.error('Failed to export develop settings', error)
    }
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget
    const file = input.files?.[0] ?? null
    // Let the same file be picked again after a cancel or an invalid import.
    input.value = ''
    if (file === null) return

    try {
      if (file.size > MAX_DEVELOP_FILE_BYTES) {
        openImportError(t('topNav.importSettingsTooLarge'))
        return
      }

      const develop = parseDevelopFile(await file.text())
      if (develop === null) {
        logger.warn(`Invalid develop settings file: ${file.name}`)
        openImportError(t('topNav.importSettingsInvalid'))
        return
      }

      setPendingFileName(file.name)
      setPending(develop)
    } catch (error) {
      logger.error('Failed to read develop settings file', error)
      openImportError(t('topNav.importSettingsInvalid'))
    }
  }

  const confirmImport = (): void => {
    if (pending === null) return
    applyDevelop(pending)
    setPending(null)
  }

  return (
    <>
      <Menu position="bottom" withArrow>
        <Menu.Target>
          <Tooltip label={t('topNav.exportSettings')} withArrow>
            <ActionIcon
              size="lg"
              variant="subtle"
              disabled={image === null}
              aria-label={t('topNav.exportSettingsTitle')}
            >
              <IconFileSettings size="1.5rem" />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconFileExport size="1rem" />}
            onClick={() => { void handleExport() }}
            disabled={!imageDirty}
          >
            {t('topNav.exportSettingsTitle')}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconFileImport size="1rem" />}
            onClick={() => inputRef.current?.click()}
          >
            {t('topNav.importSettings')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label={t('topNav.importSettings')}
        onChange={handleFileChange}
      />

      <ConfirmDialog
        opened={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={confirmImport}
        title={t('topNav.importSettingsTitle')}
        message={
          imageDirty
            ? t('topNav.importSettingsDirtyMessage', { fileName: pendingFileName })
            : t('topNav.importSettingsMessage', { fileName: pendingFileName })
        }
        confirmLabel={t('topNav.importSettingsConfirm')}
        cancelLabel={t('confirm.cancel')}
      />
    </>
  )
}
