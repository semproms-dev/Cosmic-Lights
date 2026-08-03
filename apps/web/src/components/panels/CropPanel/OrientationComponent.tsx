import { ActionIcon, Group, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { FaArrowRotateLeft, FaArrowRotateRight } from "react-icons/fa6";
import { LuFlipHorizontal2, LuFlipVertical2 } from "react-icons/lu";
import { useEditor } from '../../../editor/editorContext';

/**
 * Orientation controls: 90° turns and flips, wired to the shared editor store.
 * Each click is a discrete edit — it checkpoints its own undo step via `commit`.
 */
export function OrientationComponent() {
  const { t } = useTranslation(['common']);
  const { image, rotateCcw, rotateCw, flipH, flipV, commit } = useEditor();

  return (
    <Stack gap="xs">
      <Title order={5}>{t('masks.orientation')}</Title>
      <Group wrap="nowrap" gap="xs">
        <Text size="sm">{t('masks.rotate')}</Text>
        <Tooltip label={t('masks.rotateLeft')}>
          <ActionIcon disabled={image === null} size="sm" onClick={() => { rotateCcw(); commit(); }}>
            <FaArrowRotateLeft style={{ width: '50%' }} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('masks.rotateRight')}>
          <ActionIcon disabled={image === null} size="sm" onClick={() => { rotateCw(); commit(); }}>
            <FaArrowRotateRight style={{ width: '50%' }} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('masks.flipUp')}>
          <ActionIcon disabled={image === null} size="sm" onClick={() => { flipH(); commit(); }}>
            <LuFlipHorizontal2 style={{ width: '50%' }} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('masks.flipDown')}>
          <ActionIcon disabled={image === null} size="sm" onClick={() => { flipV(); commit(); }}>
            <LuFlipVertical2 style={{ width: '50%' }} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Stack>
  );
}
