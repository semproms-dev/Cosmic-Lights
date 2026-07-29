import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import { useDisclosure } from '@mantine/hooks'
import { useEditor } from '../../editor/editorContext'
import { ConfirmDialog } from '../window/ConfirmDialog'
import { SUPPORTED_ACCEPT } from './rawFormats'

interface OpenImageButtonProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function OpenImageButton({ fileInputRef }: OpenImageButtonProps) {
  const { loadImage, imageStatus, image, imageDirty } = useEditor()
  const [opened, { open, close }] = useDisclosure(false)
  const pendingFile = useRef<File | null>(null)

  const resetInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (image && imageDirty) {
      pendingFile.current = file
      open()
    } else {
      void loadImage(file)
      resetInput()
    }
  }

  const handleConfirm = () => {
    const file = pendingFile.current
    pendingFile.current = null
    close()
    resetInput()
    if (file) {
      void loadImage(file)
    }
  }

  const handleCancel = () => {
    pendingFile.current = null
    close()
    resetInput()
  }

  return (
    <>
      <input
        type="file"
        accept={SUPPORTED_ACCEPT}
        ref={fileInputRef}
        hidden={true}
        disabled={imageStatus === 'loading'}
        onChange={handleChange}
      />
      <ConfirmDialog
        opened={opened}
        onClose={handleCancel}
        onConfirm={handleConfirm}
        title="Discard changes?"
        message="Opening a new picture will discard all unsaved adjustments. Continue?"
        confirmLabel="Discard"
        cancelLabel="Cancel"
        confirmColor="red"
      />
    </>
  )
}
