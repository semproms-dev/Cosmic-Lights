import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { ActionIcon, Button, Grid, Image, Modal, Notification, Portal, ScrollArea, SimpleGrid, Stack, Text, Tooltip, Transition } from '@mantine/core'
import { IconFolderSearch, IconPhoto } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useEditor } from '../../editor/editorContext'
import { decodeRaw } from '../../editor/decodeRaw'
import { rgbToRgba } from '../../editor/image'
import { generateThumbnail, thumbnailFromBitmap } from '../../editor/photoImport'
import { isRawFile, isSupportedFile, SUPPORTED_ACCEPT } from './rawFormats'
import { ConfirmDialog } from '../window/ConfirmDialog'
import { ShowPreviewPicture } from '../modals/screen/ShowPreviewPicture'
import type { Metadata } from 'libraw-wasm'
import { readJpegMetadata } from '../../editor/jpegMetadata'
import { ExifPreview } from '../navigation/elements/ExifPreview'

interface DirectoryImage {
  file: File
  thumbnail: string | null
  metadata: Metadata | null
  metadataStatus: 'loading' | 'ready'
}

interface DirectoryPreview {
  thumbnail: string | null
  metadata: Metadata | null
  file: File | null
}

async function generateDirectoryPreview(file: File): Promise<DirectoryPreview> {
  //If it is not a RAW file we generate the thumbnail and read the metadata
  if(!isRawFile(file)) {
    const [thumbnail, metadata] = await Promise.all(
      [
        generateThumbnail(file),
        readJpegMetadata(file)
      ]
    )

    return {thumbnail, metadata, file};
  }

  try {
    const decoded = await decodeRaw(await file.arrayBuffer());
    const pixels = rgbToRgba(decoded.data, decoded.width, decoded.height);
    const bitmap = await createImageBitmap(new ImageData(pixels, decoded.width, decoded.height));

    try {
      return {
        thumbnail: thumbnailFromBitmap(bitmap),
        metadata: decoded.metadata,
        file
      }
    } finally {
      bitmap.close();
    }
  } catch(error) {
    return {thumbnail: null, metadata: null, file: null}
  }
}

/** Opens a directory, previews supported images and lets the user choose one for the editor. */
export function DirectoryPreviewButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const generationRef = useRef(0)
  const { loadImage, imageDirty, imageStatus } = useEditor()
  const { t } = useTranslation(['common'])
  const [images, setImages] = useState<DirectoryImage[]>([])
  const [directoryName, setDirectoryName] = useState('')
  const [opened, setOpened] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [showNoImagesNotice, setShowNoImagesNotice] = useState(false)
  const selectedImage = images.find(image => image.file === selectedFile) ?? null

  useEffect(() => {
    if (!showNoImagesNotice) return

    const timer = window.setTimeout(() => setShowNoImagesNotice(false), 4000)
    return () => window.clearTimeout(timer)
  }, [showNoImagesNotice])

  const openDirectoryPicker = () => {
    // `webkitdirectory` is the browser-supported directory picker attribute.
    inputRef.current?.setAttribute('webkitdirectory', '')
    inputRef.current?.click()
  }

  const handleDirectory = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
      .filter(file => {
        if (!isSupportedFile(file)) return false
        const pathParts = file.webkitRelativePath.split('/').filter(Boolean)
        // Directory selection includes descendants; show only files directly
        // inside the selected root folder.
        return pathParts.length === 2
      })
      .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name))
    event.currentTarget.value = ''
    if (files.length === 0) {
      setShowNoImagesNotice(true)
      return
    }

    setShowNoImagesNotice(false)
    const generation = ++generationRef.current
    const firstPath = files[0].webkitRelativePath
    setDirectoryName(firstPath?.split('/')[0] || t('directoryPreview.unknownFolder'))
    setImages(files.map(file => ({
      file,
      thumbnail: null,
      metadata: null,
      metadataStatus: 'loading',
    })))
    setSelectedFile(null)
    setOpened(true)

    // Keep thumbnail decoding bounded so a large folder does not decode every
    // image at once. RAW thumbnails use the same LibRaw decoder as the editor.
    let nextIndex = 0
    const worker = async () => {
      while (generation === generationRef.current && nextIndex < files.length) {
        const index = nextIndex++
        let preview: DirectoryPreview
        try {
          preview = await generateDirectoryPreview(files[index])
        } catch {
          preview = { thumbnail: null, metadata: null, file: null }
        }
        if (generation !== generationRef.current) return
        setImages(current => current.map(item =>
          item.file === files[index]
            ? { ...item, ...preview, file: item.file, metadataStatus: 'ready' }
            : item,
        ))
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, files.length) }, worker))
  }

  const closeDirectory = () => {
    // Invalidate in-flight workers and release the selected folder's files and
    // generated data URLs as soon as the preview closes.
    generationRef.current += 1
    setOpened(false)
    setImages([])
    setSelectedFile(null)
    setDirectoryName('')
    setPendingFile(null)
  }

  const chooseImage = (file: File) => {
    if (imageDirty) {
      setPendingFile(file)
      return
    }
    closeDirectory()
    void loadImage(file)
  }

  const confirmOpen = () => {
    const file = pendingFile
    closeDirectory()
    if (file) void loadImage(file)
  }

  return (
    <>
      <Portal>
        <div
          style={{
            position: 'fixed',
            top: 'max(24px, env(safe-area-inset-top))',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(520px, calc(100vw - 32px))',
            zIndex: 10000,
            pointerEvents: 'none',
          }}
        >
          <Transition mounted={showNoImagesNotice} transition="fade" duration={200} exitDuration={250}>
            {(transitionStyles) => (
              <Notification
                title={t('directoryPreview.noImagesTitle')}
                onClose={() => setShowNoImagesNotice(false)}
                withCloseButton
                color="red"
                styles={{
                  root: { padding: '1.25rem' },
                  title: { fontSize: '1.25rem', lineHeight: 1.3 },
                  description: { fontSize: '1.1rem', lineHeight: 1.5 },
                }}
                style={{ ...transitionStyles, width: '100%', pointerEvents: 'auto' }}
              >
                {t('directoryPreview.noImagesMessage')}
              </Notification>
            )}
          </Transition>
        </div>
      </Portal>
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_ACCEPT}
        multiple
        hidden
        onChange={handleDirectory}
      />
      <Tooltip label={t('directoryPreview.open')} withArrow>
        <ActionIcon
          size="lg"
          variant="subtle"
          onClick={openDirectoryPicker}
          disabled={imageStatus === 'loading'}
          aria-label={t('directoryPreview.open')}
        >
          <IconFolderSearch size="1.5rem" />
        </ActionIcon>
      </Tooltip>
      <Modal
        opened={opened}
        onClose={closeDirectory}
        title={t('directoryPreview.title', { directory: directoryName })}
        centered
        size="96vw"
        styles={{
          content: {
            width: '96vw',
            maxWidth: '96vw',
            height: '92vh',
            maxHeight: '92vh',
          },
          body: {
            height: 'calc(92vh - 64px)',
            padding: 'var(--mantine-spacing-lg)',
            overflow: 'auto',
          },
        }}
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">{t('directoryPreview.count', { count: images.length })}</Text>
          <Grid gutter="lg">
            <Grid.Col span={{ base: 12, md: 7 }}>
              <ScrollArea h="80vh">
                <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, lg: 5 }} spacing="sm" p="xs">
                  {images.map(({ file, thumbnail }) => {
                    const selected = file === selectedFile
                    return (
                      <button
                        key={`${file.webkitRelativePath || file.name}-${file.lastModified}`}
                        type="button"
                        onClick={() => setSelectedFile(file)}
                        onDoubleClick={() => chooseImage(file)}
                        title={file.webkitRelativePath || file.name}
                        aria-label={t('directoryPreview.choose', { name: file.name })}
                        aria-pressed={selected}
                        style={{
                          border: selected ? '2px solid var(--mantine-primary-color-filled)' : '1px solid var(--mantine-color-default-border)',
                          borderRadius: 'var(--mantine-radius-sm)',
                          padding: 6,
                          background: 'var(--mantine-color-body)',
                          color: 'inherit',
                          cursor: 'pointer',
                          textAlign: 'left',
                          minWidth: 0,
                        }}
                      >
                        {thumbnail ? (
                          <Image src={thumbnail} alt="" h={128} fit="contain" />
                        ) : (
                          <span style={{ height: 128, display: 'grid', placeItems: 'center', opacity: 0.55 }}>
                            <IconPhoto size={36} />
                          </span>
                        )}
                        <Text size="xs" truncate mt={4}>{file.name}</Text>
                      </button>
                    )
                  })}
                </SimpleGrid>
              </ScrollArea>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack gap="sm">
                <ShowPreviewPicture
                  imageUrl={selectedImage?.thumbnail ?? null}
                  imageName={selectedImage?.file.name ?? ''}
                  emptyLabel={t('directoryPreview.selectPrompt')}
                />
                <Button
                  onClick={() => selectedFile && chooseImage(selectedFile)}
                  disabled={selectedFile === null}
                >
                  {t('directoryPreview.openSelected')}
                </Button>
                <ExifPreview
                  metadata={selectedImage?.metadata ?? null}
                  loading={selectedImage?.metadataStatus === 'loading'}
                  file={selectedImage?.file}
                />
              </Stack>
            </Grid.Col>
          </Grid>
        </Stack>
      </Modal>
      <ConfirmDialog
        opened={pendingFile !== null}
        onClose={() => setPendingFile(null)}
        onConfirm={confirmOpen}
        title={t('confirm.discardTitle')}
        message={t('confirm.discardMessage')}
        confirmLabel={t('confirm.discard')}
        cancelLabel={t('confirm.cancel')}
        confirmColor="red"
      />
    </>
  )
}
