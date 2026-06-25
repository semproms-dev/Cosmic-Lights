export type ChannelId = 'rgb' | 'red' | 'green' | 'blue';

export interface CurvePoint {
    x: number;
    y: number;
}

export type Curves = Record<ChannelId, CurvePoint[]>;

//Straight line, picture without changes by the user (default)
export const IDENTITY_CURVE: CurvePoint[] = [
    {x: 0, y: 0},
    {x: 255, y: 255}
]

// All tghe different channels available
export const CHANNELS: ChannelId[] = ['rgb', 'blue', 'red', 'green'];

export function buildDefaultCurves(): Curves {
  return Object.fromEntries(
    CHANNELS.map((channel) => [channel, IDENTITY_CURVE.map((point) => ({ ...point }))]),
  ) as Curves
}