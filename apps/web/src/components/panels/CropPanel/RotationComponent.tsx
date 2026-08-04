import { Slider, Stack, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useEditor } from "../../../editor/editorContext";

export function RotationComponent() {
    const { t } = useTranslation(['common']);
    const {image, setRotationAngle, angle, commit} = useEditor();
    return (
        <Stack>
            <Title order={5}>{t('masks.rotation')}</Title>
            <Slider
              style={{flex: 1}}
              disabled={image === null}
              value={angle}
              onChange={setRotationAngle}
              onChangeEnd={commit}
              min={-45} max={45} step={0.1}
              thumbLabel={t('masks.rotation')}
            />
          </Stack>
    )
}