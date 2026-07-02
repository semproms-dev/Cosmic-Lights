import type { ChangeEvent } from 'react'
import { useEditor } from '../../editor/editorContext'

/** RAW extensions the file picker accepts. */
const RAW_ACCEPT = '.arw,.cr2,.cr3,.nef,.dng,.raf,.orf,.rw2'

/**
 * Temporary M1 file picker: decodes the chosen RAW into the editor store.
 * Will be folded into the top nav's document icon in M2.
 */
export function OpenImageButton() {
  const { loadImage, imageStatus } = useEditor()

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      void loadImage(file)
    }
  }

  return (
    <input
      type="file"
      accept={RAW_ACCEPT}
      disabled={imageStatus === 'loading'}
      onChange={handleChange}
    />
  )
}
