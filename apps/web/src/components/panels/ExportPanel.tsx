import { useState } from 'react';
import { Button, SegmentedControl, Stack, Text, Title, Checkbox } from '@mantine/core';
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
import { buildExifDict, insertExif } from '../../editor/exif';
import { randomId, useListState } from '@mantine/hooks';

const nativeFormats = Object.values(FORMAT_CAPS).filter(
  (f) => f.encoder === 'native'
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
  const { image, adjustments, curves, cropRegion, masks, maskAlphas, orientation } = useEditor();
  const [format, setFormat] = useState('JPEG');
  const [quality, setQuality] = useState(90);
  const [loading, setLoading] = useState(false);

  const currentFormat = nativeFormats.find((f) => f.format === format);
  const [values, handlers] = useListState(checkBoxValues);
  const allChecked = values.every((value) => value.checked);
  const indeterminate = values.some((value) => value.checked) && !allChecked;
  const includeMetadata = values.find((v) => v.id === 'all')?.checked ?? false;
  const includeGPS = values.find((v) => v.id === 'gps')?.checked ?? false;

  const formatKey = format.toLowerCase() as ExportFormat;

  const renderImage = (): Promise<Blob> | null => {
    if (!image) return null;

    const caps = FORMAT_CAPS[formatKey];
    if (!caps || caps.encoder !== 'native') {
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
    renderer.uploadImage(image.bitmap);
    renderer.uploadCurves(compileCurveTexture(curves));
    renderer.setCrop(cropRegion, image.width, image.height);
    renderer.setOrientation(orientation);
    renderer.render(
      toRenderAdjustments(adjustments),
      masks,
      maskAlphas.current,
      null, // no editing overlay in the exported image
      outWidth,
      outHeight,
    );

    const qualityNorm = normalizeQuality(quality);
    const blobPromise = new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
        caps.mime,
        caps.hasQuality ? qualityNorm : undefined,
      );
    });

    blobPromise.finally(() => renderer.dispose());
    return blobPromise;
  };

  const handleExport = async () => {
    if (!image) return;

    const blob = renderImage();
    if (!blob) return;

    const caps = FORMAT_CAPS[formatKey];
    const extension = exportExtension(formatKey);
    const fileName = exportFileName('export', formatKey);

    setLoading(true);
    try {
      let out = await blob;
      // JPEG is the only native format with an EXIF container; when the user
      // opted into metadata, rebuild it from the source RAW and embed it (the
      // canvas re-encode dropped all of it). Every other case saves as-is.
      if (formatKey === 'jpeg' && includeMetadata) {
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
          data={nativeFormats.map((f) => ({ value: f.format, label: f.format }))}
        />
        {currentFormat && currentFormat.hasMetadata && (
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
      <Button onClick={handleExport} disabled={!image} loading={loading}>Export image</Button>
    </Stack>
  );
}
