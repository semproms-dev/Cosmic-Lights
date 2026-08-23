import { useState } from 'react'
import type { MouseEvent } from 'react'
import { Button, Group } from '@mantine/core'
import { IconChevronDown, IconChevronRight, IconPhoto, IconStack2 } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useEditor } from '../../editor/editorContext'
import { useLibrary } from '../../editor/libraryContext'
import { stackOf, visibleItems } from '../../editor/library'
import type { PhotoId } from '../../editor/library'
import { ConfirmDialog } from '../window/ConfirmDialog'
import classes from './LibraryStrip.module.css'

/**
 * Bottom filmstrip over the imported photos and their stacks.
 *
 * Interactions:
 * - a photo is selected by clicking (exclusively) or toggled with ctrl/cmd;
 * - a stack item selects all of its members, its badge expands/collapses it,
 *   and double-clicking opens the key photo;
 * - a photo opens in the editor on double-click, going through the discard
 *   confirmation when the current edit is dirty.
 */
export function LibraryStrip() {
  const { library, stackPhotos, unstackPhoto, toggleCollapsed, autoStack, getFile } = useLibrary()
  const { imageDirty, loadImage } = useEditor()
  const { t } = useTranslation(['common'])
  const [selected, setSelected] = useState<ReadonlySet<PhotoId>>(new Set())
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [collapsed, setCollapsed] = useState(true)

  const items = visibleItems(library)
  const canStack = selected.size >= 2
  const canUnstack = [...selected].some(id => stackOf(library, id) !== null)
  const hasTimedPhotos = [...library.photos.values()].some(photo => photo.captureTime !== null)

  /** The photo a stack presents when collapsed — its cover. */
  const keyPhotoOf = (photoId: PhotoId) => library.photos.get(photoId)

  const toggleMember = (photoId: PhotoId) => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(photoId)) next.delete(photoId)
      else next.add(photoId)
      return next
    })
  }

  const handlePhotoClick = (photoId: PhotoId, event: MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      toggleMember(photoId)
      return
    }
    // A plain click re-clicking the lone selection clears it; otherwise it is
    // an exclusive select — shift-range selection can come later.
    if (selected.size === 1 && selected.has(photoId)) setSelected(new Set())
    else setSelected(new Set([photoId]))
  }

  const openPhoto = (photoId: PhotoId) => {
    const file = getFile(photoId)
    if (file === null) return
    // Same contract as opening from disk: dirty edits ask before dying.
    if (imageDirty) setPendingFile(file)
    else void loadImage(file)
  }

  const handleStack = () => {
    stackPhotos([...selected])
    setSelected(new Set())
  }

  const handleUnstack = () => {
    for (const photoId of selected) unstackPhoto(photoId)
    setSelected(new Set())
  }

  return (
    <section className={classes.strip} aria-label={t('library.title')}>
      <button
        type="button"
        className={classes.header}
        onClick={() => setCollapsed(value => !value)}
        aria-expanded={!collapsed}
      >
        {collapsed ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
        {t('library.title')}
        <span className={classes.count}>({items.length})</span>
      </button>
      {!collapsed && (
        <>
          <Group gap="xs" px="md" pb="xs">
            <Button size="compact-sm" variant="default" leftSection={<IconStack2 size={14} />} disabled={!canStack} onClick={handleStack}>
              {t('library.stack')}
            </Button>
            <Button size="compact-sm" variant="default" disabled={!canUnstack} onClick={handleUnstack}>
              {t('library.unstack')}
            </Button>
            <Button size="compact-sm" variant="default" disabled={!hasTimedPhotos} onClick={() => autoStack()}>
              {t('library.autoStack')}
            </Button>
          </Group>
          <div className={classes.body}>
            {items.map(item =>
              item.kind === 'photo' ? (
                <button
                  key={item.photo.id}
                  type="button"
                  className={classes.item}
                  data-selected={selected.has(item.photo.id) || undefined}
                  onClick={event => handlePhotoClick(item.photo.id, event)}
                  onDoubleClick={() => openPhoto(item.photo.id)}
                >
                  <Thumb url={item.photo.thumbUrl} alt={item.photo.fileName} />
                  <span className={classes.name}>{item.photo.fileName}</span>
                </button>
              ) : (
                <div key={item.stack.id} style={{ display: 'flex', gap: 2 }}>
                  <button
                    type="button"
                    className={classes.item}
                    data-selected={item.stack.photoIds.every(id => selected.has(id)) || undefined}
                    onClick={() =>
                      setSelected(new Set(item.stack.photoIds))
                    }
                    onDoubleClick={() => openPhoto(item.stack.keyPhotoId)}
                  >
                    <Thumb
                      url={keyPhotoOf(item.stack.keyPhotoId)?.thumbUrl ?? null}
                      alt={keyPhotoOf(item.stack.keyPhotoId)?.fileName ?? ''}
                    />
                    <span className={classes.badge}>{item.stack.photoIds.length}</span>
                    <span className={classes.name}>
                      {keyPhotoOf(item.stack.keyPhotoId)?.fileName ?? ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={classes.item}
                    aria-label={
                      item.stack.collapsed ? t('library.expand') : t('library.collapse')
                    }
                    onClick={() => toggleCollapsed(item.stack.id)}
                    style={{ alignSelf: 'center' }}
                  >
                    {item.stack.collapsed ? (
                      <IconChevronRight size={14} />
                    ) : (
                      <IconChevronDown size={14} />
                    )}
                  </button>
                </div>
              ),
            )}
          </div>
        </>
      )}
      <ConfirmDialog
        opened={pendingFile !== null}
        onClose={() => setPendingFile(null)}
        onConfirm={() => {
          const file = pendingFile
          setPendingFile(null)
          if (file !== null) void loadImage(file)
        }}
        title={t('confirm.discardTitle')}
        message={t('confirm.discardMessage')}
        confirmLabel={t('confirm.discard')}
        cancelLabel={t('confirm.cancel')}
        confirmColor="red"
      />
    </section>
  )
}

interface ThumbProps {
  /** Thumbnail data URL, or `null` for the placeholder. */
  url: string | null
  alt: string
}

/** The square thumbnail, or a neutral placeholder while none exists yet. */
function Thumb({ url, alt }: ThumbProps) {
  return url !== null ? (
    <img src={url} alt={alt} className={classes.thumb} draggable={false} />
  ) : (
    <span className={classes.placeholder}>
      <IconPhoto size={28} stroke={1.5} />
    </span>
  )
}
