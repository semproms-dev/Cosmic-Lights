import { Group, Stack, Text, Title } from '@mantine/core';
import { useEditor } from '../../editor/editorContext';
import { formatAperture, formatShutterSpeed } from '../../utils';
import { MdOutlineShutterSpeed } from "react-icons/md";
import { IoAperture } from "react-icons/io5";
import { AiFillVideoCamera } from "react-icons/ai";
import { BiSolidCameraPlus } from "react-icons/bi";
import { SiLens } from "react-icons/si";
import { useTranslation } from 'react-i18next';

/**
 * Info tool panel. A placeholder until an image pipeline exists; it will show
 * read-only photo metadata (EXIF) once an image can be opened
 */
export function InfoPanel() {

  const image = useEditor();
  const { t } = useTranslation(['common']); 
  const loaded = image.image;
  const {
    camera_model,
    camera_make,
    aperture,
    focal_len,
    iso_speed,
    shutter,
    lens
  } = loaded?.metadata ?? {};
  const {
    fileName
  } = image.image ?? {}


  return (
    <Stack gap="xs">
      <Title order={5}>Info</Title>
      {loaded ? (
        <Stack>
          <Group>
            <Text fw={700}>File: </Text>
            <Text>{fileName}</Text>
          </Group>
          <Group>
            <Text fw={700}>Brand: </Text>
            <Text>{camera_make}</Text>
          </Group>
          <Group>
            <Text fw={700}>Model: </Text>
            <Text>{camera_model}</Text>
          </Group>
          <Group>
            <IoAperture/>
            <Text>{aperture ? formatAperture(aperture) : '-'}</Text>
          </Group>
          <Group>
            <AiFillVideoCamera/>
            <Text>{focal_len === 0 ? '-' : `${focal_len}mm`}</Text>
          </Group>
          <Group>
            <BiSolidCameraPlus/>
            <Text>{iso_speed}</Text>
          </Group>
          <Group>
            <MdOutlineShutterSpeed />
            <Text>{shutter ? formatShutterSpeed(shutter) : '-'}</Text>
          </Group>
          <Group>
            <SiLens/>
            <Text>{lens?.Lens || lens?.makernotes?.Lens || '-'}</Text>
          </Group>
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          {t('info.empty')}
        </Text>
      )}
    </Stack>
  );
}
