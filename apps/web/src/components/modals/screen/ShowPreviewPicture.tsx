import { Image, Paper, Stack, Text } from '@mantine/core'
import { IconPhoto } from '@tabler/icons-react'

interface ShowPreviewPictureProps {
  imageUrl: string | null
  imageName: string
  emptyLabel: string
}

/** Shows a larger preview of the image currently selected in the directory grid. */
export function ShowPreviewPicture({ imageUrl, imageName, emptyLabel }: ShowPreviewPictureProps) {
  return (
    <Paper
      withBorder
      radius="sm"
      p="sm"
      style={{ minHeight: 520, display: 'grid', placeItems: 'center' }}
    >
      {imageUrl ? (
        <Stack gap="xs" w="100%" align="center">
          <Image src={imageUrl} alt={imageName} h={470} fit="contain" />
          <Text size="sm" fw={500} ta="center" lineClamp={1} w="100%">{imageName}</Text>
        </Stack>
      ) : (
        <Stack gap="xs" align="center" c="dimmed">
          <IconPhoto size={48} stroke={1.25} />
          <Text size="sm" ta="center">{emptyLabel}</Text>
        </Stack>
      )}
    </Paper>
  );
}
