import { Slider, Stack, Title } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor } from "../../../editor/editorContext";

export function RotationComponent() {
    const [value, setValue] = useState(0);
    const { t } = useTranslation(['common']);
    const {image} = useEditor();
    return (
        <Stack>
            <Title order={5}>{t('masks.rotation')}</Title>
            <Slider
              style={{flex: 1}}
              disabled={image === null}
              defaultValue={40}
              value={value}
              onChange={setValue}
              marks={[
                { value: 20, label: '20%' },
                { value: 50, label: '50%' },
                { value: 80, label: '80%' },
              ]}
              thumbLabel={t('masks.brushSize')}
            />
          </Stack>
    )
}