/**
 * Functions to use through the project
 */

export const groupBy = <T, K extends PropertyKey>(arr: T[], key: (i: T) => K): Record<K, T[]> =>
  arr.reduce((groups, item) => {
    (groups[key(item)] ||= []).push(item);
    return groups;
  }, {} as Record<K, T[]>);

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
}

export const formatShutterSpeed = (shutter: number): string => {
  if (shutter < 1) {
    const denominator = Math.round(1 / shutter);
    return `1/${denominator}s`;
  }
  return `${Math.round(shutter)}s`;
};

export const formatAperture = (apperture: number): string => {
  return `f/${apperture.toFixed(1)}`;
}

export const MIN_CROP_SIZE = 10;