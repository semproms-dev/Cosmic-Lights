import { SegmentedControl } from "@mantine/core";
import { CHANNELS, type ChannelId } from "../../../editor/curves";

interface ChannelTabsProps {
    value: ChannelId,
    onChange: (channel: ChannelId) => void;
    /** Greys out the control and blocks channel switching when no image is open. */
    disabled?: boolean;
}

export const ChannelTabs = ({ value, onChange, disabled = false }: ChannelTabsProps) => {

    const CHANNEL_LABELS = { rgb:'RGB', red:'Red', green:'Green', blue:'Blue' }
    const data = CHANNELS.map(id => ({value: id, label: CHANNEL_LABELS[id]}));

    return (
        <SegmentedControl
            fullWidth
            disabled={disabled}
            value={value}
            data={data}
            onChange={(next) => onChange(next as ChannelId)}
        />
    )
}
