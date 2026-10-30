import { Group, Stack, Text } from '@mantine/core';
import { IconBuildingFactory2, IconCalendarTime, IconCamera, IconPhoto } from '@tabler/icons-react';
import { useEditor } from '../../editor/editorContext';
import { formatAperture, formatShutterSpeed } from '../../utils';
import { MdOutlineShutterSpeed } from "react-icons/md";
import { IoAperture } from "react-icons/io5";
import { AiFillVideoCamera } from "react-icons/ai";
import { BiSolidCameraPlus } from "react-icons/bi";
import { SiLens } from "react-icons/si";
import { useTranslation } from 'react-i18next';

/** Read-only file and camera metadata for the currently loaded photo. */
export function InfoPanel() {

  const image = useEditor();
  const { t, i18n } = useTranslation(['common']);
  const loaded = image.image;
  const {
    camera_model,
    camera_make,
    aperture,
    focal_len,
    iso_speed,
    shutter,
    lens,
    timestamp,
  } = loaded?.metadata ?? {};
  const {
    fileName
  } = image.image ?? {}
  const captureTime = timestamp instanceof Date && Number.isFinite(timestamp.getTime()) && timestamp.getTime() !== 0
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(timestamp)
    : '-';


  return (
    <Stack gap="xs">
      {loaded ? (
        <Stack>
          <Group wrap="nowrap">
            <IconPhoto size={18} stroke={1.8} aria-hidden="true" />
            <Text fw={700}>{t('info.file')}</Text>
            <Text>{fileName ?? '-'}</Text>
          </Group>
          <Group wrap="nowrap">
            <IconCalendarTime size={18} stroke={1.8} aria-hidden="true" />
            <Text fw={700}>{t('info.captureDate')}</Text>
            <Text>{captureTime}</Text>
          </Group>
          <Group wrap="nowrap">
            <IconBuildingFactory2 size={18} stroke={1.8} aria-hidden="true" />
            <Text fw={700}>{t('info.brand')}</Text>
            <Text>{camera_make || '-'}</Text>
          </Group>
          <Group wrap="nowrap">
            <IconCamera size={18} stroke={1.8} aria-hidden="true" />
            <Text fw={700}>{t('info.model')}</Text>
            <Text>{camera_model || '-'}</Text>
          </Group>
          <Group wrap="nowrap">
            <IoAperture/>
            <Text fw={700}>{t('info.aperture')}</Text>
            <Text>{aperture ? formatAperture(aperture) : '-'}</Text>
          </Group>
          <Group wrap="nowrap">
            <AiFillVideoCamera/>
            <Text fw={700}>{t('info.focalLength')}</Text>
            <Text>{focal_len ? `${focal_len}mm` : '-'}</Text>
          </Group>
          <Group wrap="nowrap">
            <BiSolidCameraPlus/>
            <Text fw={700}>{t('info.iso')}</Text>
            <Text>{iso_speed || '-'}</Text>
          </Group>
          <Group wrap="nowrap">
            <MdOutlineShutterSpeed />
            <Text fw={700}>{t('info.shutter')}</Text>
            <Text>{shutter ? formatShutterSpeed(shutter) : '-'}</Text>
          </Group>
          <Group wrap="nowrap">
            <SiLens/>
            <Text fw={700}>{t('info.lens')}</Text>
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
