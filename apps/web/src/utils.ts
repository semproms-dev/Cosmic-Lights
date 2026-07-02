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