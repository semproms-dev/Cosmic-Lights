import { describe, expect, it, vi } from 'vitest'
import { SUPPORTED_ACCEPT, isFileJpg, isRawFile, isSupportedFile } from './rawFormats'

/** A File with the given name and MIME type; the bytes are irrelevant here. */
function file(name: string, type = ''): File {
  return new File(['x'], name, { type })
}

/** A File with real bytes, for the tests that ask what is actually inside it. */
function fileWithBytes(name: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name)
}

describe('isRawFile', () => {
  it('recognises the RAW extensions', () => {
    expect(isRawFile(file('DSC01234.arw'))).toBe(true)
    expect(isRawFile(file('IMG_0001.cr3'))).toBe(true)
  })

  it('ignores the case of the extension', () => {
    // Cameras write them uppercase more often than not.
    expect(isRawFile(file('DSC01234.ARW'))).toBe(true)
  })

  it('says no to an already-developed file', () => {
    // This is what picks the decoder: a true here would send a JPEG to LibRaw.
    expect(isRawFile(file('photo.jpg', 'image/jpeg'))).toBe(false)
  })
})

describe('isSupportedFile', () => {
  it('accepts both RAW and JPEG', () => {
    expect(isSupportedFile(file('DSC01234.arw'))).toBe(true)
    expect(isSupportedFile(file('photo.jpg', 'image/jpeg'))).toBe(true)
    expect(isSupportedFile(file('photo.jpeg', 'image/jpeg'))).toBe(true)
  })

  it('accepts a JPEG whose name lost its extension', () => {
    // A download or a paste can arrive named "image"; the MIME type of a JPEG
    // is reliable (unlike RAW), so it is worth trusting as a fallback.
    expect(isSupportedFile(file('image', 'image/jpeg'))).toBe(true)
  })

  it('rejects what the app cannot decode', () => {
    expect(isSupportedFile(file('notes.pdf', 'application/pdf'))).toBe(false)
    expect(isSupportedFile(file('clip.mp4', 'video/mp4'))).toBe(false)
    // PNG and friends would decode fine in the browser, but they are not
    // offered yet: accepting them here would let files through that the file
    // picker never advertised.
    expect(isSupportedFile(file('screenshot.png', 'image/png'))).toBe(false)
  })
})

describe('isFileJpg', () => {
  it('recognises a JPEG by its start-of-image marker', async () => {
    expect(await isFileJpg(fileWithBytes('photo.jpg', [0xff, 0xd8, 0xff, 0xe0]))).toBe(true)
  })

  it('sees through a JPEG that was renamed to a RAW extension', async () => {
    // The whole reason the check exists: the name says NEF, the bytes say JPEG,
    // and the bytes win.
    expect(await isFileJpg(fileWithBytes('renamed.nef', [0xff, 0xd8, 0xff, 0xe0]))).toBe(true)
  })

  it('says no to a real RAW, whatever it is called', async () => {
    // A TIFF-based RAW (NEF, CR2, ARW, DNG...) opens with "II*\0".
    expect(await isFileJpg(fileWithBytes('shot.nef', [0x49, 0x49, 0x2a, 0x00]))).toBe(false)
    expect(await isFileJpg(fileWithBytes('renamed.jpg', [0x49, 0x49, 0x2a, 0x00]))).toBe(false)
  })

  it('is not fooled by a file too short to hold the marker', async () => {
    // `every` over the signature would pass vacuously on an empty read if the
    // comparison were written the other way round.
    expect(await isFileJpg(fileWithBytes('empty.jpg', []))).toBe(false)
    expect(await isFileJpg(fileWithBytes('truncated.jpg', [0xff, 0xd8]))).toBe(false)
  })

  it('falls back to no rather than throwing when the bytes cannot be read', async () => {
    // A file the OS will not hand over still has to fail at decode, with a real
    // message — not here, where all we could say is "no header".
    const unreadable = fileWithBytes('locked.jpg', [0xff, 0xd8, 0xff])
    vi.spyOn(unreadable, 'slice').mockImplementation(() => {
      throw new Error('permission denied')
    })

    expect(await isFileJpg(unreadable)).toBe(false)
  })
})

describe('SUPPORTED_ACCEPT', () => {
  it('advertises RAW and JPEG to the file picker', () => {
    expect(SUPPORTED_ACCEPT).toContain('.arw')
    expect(SUPPORTED_ACCEPT).toContain('.jpg')
    expect(SUPPORTED_ACCEPT).toContain('.jpeg')
  })
})
