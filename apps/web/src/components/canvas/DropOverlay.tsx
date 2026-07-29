import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { Text } from '@mantine/core'
import { IconPhoto, IconUpload } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import classes from './DropOverlay.module.css'
import { SUPPORTED_ACCEPT } from './rawFormats'

interface DropOverlayProps {
  /** Whether an image is currently open (hides the persistent empty state). */
  imageLoaded: boolean
  /** Called with the dropped or picked file; the parent decides what to do. */
  onDropFile: (file: File) => void
}

/**
 * Tracks whether a file (not text/selection) is being dragged anywhere over the
 * window. A depth counter cancels out the `dragenter`/`dragleave` pair that
 * fires as the pointer crosses child elements, which would otherwise flicker.
 * Also suppresses the browser's default "open the dropped file" navigation.
 */
function useWindowFileDrag(): boolean {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent | globalThis.DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onEnter = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return
      depth += 1
      setDragging(true)
    }
    const onLeave = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return
      depth -= 1
      if (depth <= 0) {
        depth = 0
        setDragging(false)
      }
    }
    const onOver = (event: globalThis.DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onDrop = (event: globalThis.DragEvent) => {
      event.preventDefault()
      depth = 0
      setDragging(false)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return dragging
}

/**
 * Native drag-and-drop affordance for opening a RAW photo, replacing Mantine's
 * Dropzone with a lightweight overlay that never sits over the canvas' pointer
 * handlers while editing. It is rendered only when there is no image yet (a
 * persistent, clickable prompt) or while a file is being dragged (a transient
 * full-viewport target to catch the drop).
 */
export function DropOverlay({ imageLoaded, onDropFile }: DropOverlayProps) {
  const { t } = useTranslation(['common'])
  const dragging = useWindowFileDrag()
  const inputRef = useRef<HTMLInputElement>(null)

  if (imageLoaded && !dragging) return null

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) onDropFile(file)
  }

  const handlePick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onDropFile(file)
    event.target.value = ''
  }

  const Icon = dragging ? IconUpload : IconPhoto

  return (
    <div
      className={classes.overlay}
      data-dragging={dragging || undefined}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_ACCEPT}
        hidden
        onChange={handlePick}
      />
      <div className={classes.content}>
        <Icon
          size={52}
          stroke={1.5}
          color={
            dragging
              ? 'var(--mantine-color-blue-6)'
              : 'var(--mantine-color-dimmed)'
          }
        />
        <Text size="xl" inline>
          {t('dropzone.title')}
        </Text>
        <Text size="sm" c="dimmed" inline>
          {t('dropzone.hint')}
        </Text>
      </div>
    </div>
  )
}
