import { Stack, Text, Title } from '@mantine/core';

/**
 * Info tool panel. A placeholder until an image pipeline exists; it will show
 * read-only photo metadata (EXIF) once an image can be opened.
 */
export function InfoPanel() {
  return (
    <Stack gap="xs">
      <Title order={5}>Info</Title>
      <Text size="sm" c="dimmed">
        No image loaded. Photo metadata (EXIF) will appear here once an image is
        opened.
      </Text>
    </Stack>
  );
}
