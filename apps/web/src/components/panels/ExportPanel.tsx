import { useState } from 'react';
import { Button, SegmentedControl, Stack, Text, Title, Checkbox, Alert, Select } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { ControlSlider } from '../sliders/elements/ControlSlider';
import { useEditor } from '../../editor/editorContext';
import { WebGLRenderer } from '../../editor/gl/renderer';
import { compileCurveTexture } from '../../editor/curvesMath';
import { toRenderAdjustments } from '../../editor/renderAdjustments';
import { logger } from '../../logger';
import { FORMAT_CAPS, type ExportFormat } from '../../editor/exportFormats';
import {
  exportDimensions,
  exportExtension,
  exportFileName,
  normalizeQuality,
} from '../../editor/export';
import { buildExifDict, buildTiffMetadata, insertExif } from '../../editor/exif';
import { randomId, useListState } from '@mantine/hooks';
import { TIFF_BITS } from '../../utils';

interface TiffRuntime {
  FS: {
    writeFile(path: string, data: Uint8Array): Promise<void>;
    unlink(path: string): Promise<void>;
    rmdir(path: string): Promise<void>;
  };
  getRandomPath(path: string): Promise<string>;
  getFileBytes(path: string): Promise<Uint8Array>;
  TiffEncoder: {
    encodeTiff(
      rgbaPath: string,
      tiffPath: string,
      width: number,
      height: number,
      bitDepth: 8 | 16,
      metadataJson: string,
    ): Promise<void>;
  };
}

let tiffRuntimePromise: Promise<TiffRuntime> | null = null;

/** Load the TIFF WebAssembly runtime only when the user exports a TIFF. */
const loadTiffRuntime = (): Promise<TiffRuntime> => {
  if (tiffRuntimePromise === null) {
    tiffRuntimePromise = import('../../native/tiff_encoder.h')
      .then(async ({ initNative }) => (await initNative()) as TiffRuntime)
      .catch((error: unknown) => {
        // Allow another attempt if initialization failed (for example, a
        // transient failure fetching the WASM asset).
        tiffRuntimePromise = null;
        throw error;
      });
  }
  return tiffRuntimePromise;
};

const availableFormats = Object.values(FORMAT_CAPS).filter(
  (f) => (f.encoder === 'native' || f.encoder === 'wasm') && f.isAvailable === true
);

interface exportMetadata {
  id: 'all' | 'gps';
  label: string;
  checked: boolean;
  key: string;
}

const checkBoxValues: exportMetadata[] = [
  // Privacy default: embed camera metadata, but not the GPS location.
  {id:'gps', label: 'Include GPS location', checked: false, key: randomId()},
  {id: 'all', label: 'Include camera metadata', checked: true, key: randomId()}
]

/** Read a Blob as a data URL — piexif operates on data URLs / binary strings. */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Embed an EXIF dict into a JPEG blob, returning a new blob with the metadata. */
const embedExif = async (
  blob: Blob,
  dict: ReturnType<typeof buildExifDict>,
): Promise<Blob> => {
  const dataUrl = await blobToDataUrl(blob);
  const withExif = insertExif(dataUrl, dict);
  return (await fetch(withExif)).blob();
};

export function ExportPanel() {
  const { image, adjustments, curves, cropRegion, masks, maskAlphas, orientation, geometry } = useEditor();
  const [format, setFormat] = useState('JPEG');
  const [quality, setQuality] = useState(90);
  const [loading, setLoading] = useState(false);
  const [bits, setBits] = useState<8 | 16>(8);
  const disabled = image === null;

  const supported = typeof window !== 'undefined' && 
                    window.isSecureContext && 
                    typeof window.showSaveFilePicker === 'function';

  const currentFormat = availableFormats.find((f) => f.format === format);
  const [values, handlers] = useListState(checkBoxValues);
  const allChecked = values.every((value) => value.checked);
  const indeterminate = values.some((value) => value.checked) && !allChecked;
  const includeMetadata = values.find((v) => v.id === 'all')?.checked ?? false;
  const includeGPS = values.find((v) => v.id === 'gps')?.checked ?? false;

  const formatKey = format.toLowerCase() as ExportFormat;

  const renderImage = async (): Promise<Blob | null> => {
    if (!image) return null;

    const caps = FORMAT_CAPS[formatKey];
    if (
      !caps ||
      !caps.isAvailable ||
      (caps.encoder !== 'native' && formatKey !== 'tiff')
    ) {
      logger.error(`Export: ${format} is not yet supported`);
      return null;
    }

    // Size the output to the frame as displayed — the crop (rounded, since a
    // drag leaves sub-pixel sizes) or the full image, with the axes swapped on
    // an odd turn. Passing these same dimensions to render() makes the canvas
    // aspect match the displayed aspect, so the letterbox scale collapses to
    // identity: the frame fills the output with no bars, at native resolution.
    const { width: outWidth, height: outHeight } = exportDimensions(
      cropRegion,
      image.width,
      image.height,
      orientation,
    );

    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not available');

    const renderer = new WebGLRenderer(gl);
    renderer.uploadImage(image.bitmap, image.noise);
    // The export is never interactive, so it always gets the slow denoise. A
    // file the user is going to keep should not carry the compromises the
    // preview makes to stay at 60 fps.
    //
    // And it must NOT be spread over frames: this renders once and reads the
    // pixels straight back, so a progressive pass would export the first slice
    // of the work rather than the finished result.
    renderer.setDenoiseQuality('quality', false);
    renderer.uploadCurves(compileCurveTexture(curves));
    renderer.setCrop(cropRegion, image.width, image.height);
    renderer.setOrientation(orientation);
    // The third consumer of the UV transform, and the one that has already been
    // forgotten once (the first rotation shipped with an unrotated export).
    // exportDimensions needs no geometry of its own: the geometry moves the
    // picture inside the frame, never the frame itself.
    renderer.setGeometry(geometry);
    renderer.render(
      toRenderAdjustments(adjustments),
      masks,
      maskAlphas.current,
      null, // no editing overlay in the exported image
      outWidth,
      outHeight,
    );

    try {
      if (formatKey === 'tiff') {
        // WebGL's default framebuffer is the rendered canvas. readPixels starts
        // at its lower-left corner and returns four 8-bit channels per pixel.
        const pixelBottomUp = new Uint8Array(outWidth * outHeight * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readBuffer(gl.BACK);
        gl.readPixels(
          0,
          0,
          outWidth,
          outHeight,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixelBottomUp,
        );

        // TIFF scanlines are written top-to-bottom. Reverse WebGL's row order
        // in place so the input file's first row is at the top, without
        // allocating a second full-size pixel buffer.
        const rowBytes = outWidth * 4;
        const rowBuffer = new Uint8Array(rowBytes);
        for (let y = 0; y < Math.floor(outHeight / 2); y++) {
          const topStart = y * rowBytes;
          const bottomStart = (outHeight - 1 - y) * rowBytes;
          rowBuffer.set(pixelBottomUp.subarray(topStart, topStart + rowBytes));
          pixelBottomUp.copyWithin(topStart, bottomStart, bottomStart + rowBytes);
          pixelBottomUp.set(rowBuffer, bottomStart);
        }

        const native = await loadTiffRuntime();
        const directory = await native.getRandomPath('/memfs');
        const rgbaPath = `${directory}/pixels.rgba`;
        const tiffPath = `${directory}/export.tiff`;
        try {
          await native.FS.writeFile(rgbaPath, pixelBottomUp);
          const metadata = image.metadata
            ? buildTiffMetadata(image.metadata, { includeMetadata, includeGPS })
            : {};
          await native.TiffEncoder.encodeTiff(
            rgbaPath,
            tiffPath,
            outWidth,
            outHeight,
            bits,
            JSON.stringify(metadata),
          );
          const encodedBytes = await native.getFileBytes(tiffPath);
          return new Blob([encodedBytes.buffer as ArrayBuffer], {
            type: caps.mime ?? 'image/tiff',
          });
        } finally {
          await Promise.allSettled([
            native.FS.unlink(rgbaPath),
            native.FS.unlink(tiffPath),
          ]);
          await native.FS.rmdir(directory).catch(() => undefined);
        }
      }

      const qualityNorm = normalizeQuality(quality);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
          caps.mime,
          caps.hasQuality ? qualityNorm : undefined,
        );
      });
    } finally {
      renderer.dispose();
    }
  };

  const handleExport = async () => {
    if (!image) return;

    const caps = FORMAT_CAPS[formatKey];
    if (!caps) return;
    const extension = exportExtension(formatKey);
    const fileName = exportFileName('export', formatKey);

    setLoading(true);
    try {
      const blob = await renderImage();
      if (!blob) return;
      let out = blob;
      // JPEG is the only native format with an EXIF container; when the user
      // opted into metadata, rebuild it from the source RAW and embed it (the
      // canvas re-encode dropped all of it). Every other case saves as-is.
      // `image.metadata` is null when the source was already developed (a JPEG
      // opened straight from disk): there is no camera block to rebuild, so the
      // export just carries none.
      if (formatKey === 'jpeg' && includeMetadata && image.metadata !== null) {
        const dict = buildExifDict(image.metadata, { includeMetadata, includeGPS });
        out = await embedExif(out, dict);
      }
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: `${caps.format} image`,
            accept: caps.mime ? { [caps.mime]: [`.${extension}`] } : {},
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(out);
        await writable.close();
      } else {
        const url = URL.createObjectURL(out);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      logger.error('Export failed', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack gap="md">
      <Title order={5}>Export</Title>
      <Stack gap={4}>
        <Text size="sm">Format</Text>
        <SegmentedControl
          fullWidth
          value={format}
          onChange={setFormat}
          orientation='vertical'
          data={availableFormats.map((f) => ({ value: f.format, label: f.format }))}
        />
        {/* No camera block to offer when the source was a plain JPEG: the
            checkboxes would promise metadata the export cannot carry. */}
        {currentFormat && currentFormat.hasMetadata && image?.metadata != null && (
          <>
            <Text size='sm'>Metadata</Text>
            <Checkbox
              checked={allChecked}
              indeterminate={indeterminate}
              label='Include Metadata'
              onChange={() => {
                // Drive every item to a single target so mixed state syncs:
                // all-checked → clear all, otherwise → check all.
                const next = !allChecked;
                handlers.setState((current) =>
                  current.map((value) => ({ ...value, checked: next }))
                )
              }}
            />
            {values.map((value, index) => (
              <Checkbox
                mt={'xs'}
                ml={33}
                label={value.label}
                key={value.key}
                checked={value.checked}
                onChange={(event) => handlers.setItemProp(index, 'checked', event.currentTarget.checked)}
              />
            ))}
          </>
        )}

      </Stack>
      {currentFormat && currentFormat.hasQuality &&
        <ControlSlider
        label="Quality"
        value={quality}
        min={0}
        max={100}
        step={1}
        onChange={setQuality}
      />
      }
      {formatKey === 'tiff' ? 
        <Select
          title='Bits'
          label='Bits'
          value={String(bits)}
          data={TIFF_BITS}
          disabled={disabled}
          onChange={(value) => {
            if(value === '8' || value === '16') {
              setBits(Number(value) as 8 | 16)
            }
          }}
        >
        </Select> 
      : null}
      <Button onClick={handleExport} disabled={!image} loading={loading}>Export image</Button>
      {supported && (
        <Alert icon={<IconInfoCircle />} title="Downloads folder" color="info">
          Your browser does not support picking a save location. The image will be saved to your default downloads folder.
        </Alert>
      )}
    </Stack>
  );
}
