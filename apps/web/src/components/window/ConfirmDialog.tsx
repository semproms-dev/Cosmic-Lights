import { Button, Group, Modal, Text, type ModalProps } from '@mantine/core'

export interface ConfirmDialogProps extends Pick<ModalProps, 'centered' | 'size'> {
  opened: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  confirmColor?: string
  loading?: boolean
}

export function ConfirmDialog({
  opened,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmColor,
  loading = false,
  centered = true,
  size = 'sm',
}: ConfirmDialogProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered={centered} size={size}>
      <Text>{message}</Text>
      <Group mt="xl" justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button color={confirmColor} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </Group>
    </Modal>
  )
}
