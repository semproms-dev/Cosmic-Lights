import { describe, expect, it } from 'vitest'
import { SUPPORTED_ACCEPT, isRawFile, isSupportedFile } from './rawFormats'

/** A File with the given name and MIME type; the bytes are irrelevant here. */
function file(name: string, type = ''): File {
  return new File(['x'], name, { type })
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

describe('SUPPORTED_ACCEPT', () => {
  it('advertises RAW and JPEG to the file picker', () => {
    expect(SUPPORTED_ACCEPT).toContain('.arw')
    expect(SUPPORTED_ACCEPT).toContain('.jpg')
    expect(SUPPORTED_ACCEPT).toContain('.jpeg')
  })
})
