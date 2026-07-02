import { SegmentedControl } from "@mantine/core";
import { CHANNELS, type ChannelId } from "../../../editor/curves";

interface ChannelTabsProps {
    value: ChannelId,
    onChange: (channel: ChannelId) => void;
}

export const ChannelTabs = ({ value, onChange }: ChannelTabsProps) => {
 
    const CHANNEL_LABELS = { rgb:'RGB', red:'Red', green:'Green', blue:'Blue' }
    const data = CHANNELS.map(id => ({value: id, label: CHANNEL_LABELS[id]}));

    return (
        <SegmentedControl
            fullWidth
            value={value}
            data={data}
            onChange={(next) => onChange(next as ChannelId)}
        />
    )
}
