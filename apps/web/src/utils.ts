/**
 * Functions to use through the project
 */

import type { CropOverlayType } from "./editor/editorContext";

export const APP_NAME = 'CosmicLights';

export const CropValues: CropOverlayType[] = ['thirds', 'diagonal', 'square', 'spiral'];

export const groupBy = <T, K extends PropertyKey>(arr: T[], key: (i: T) => K): Record<K, T[]> =>
  arr.reduce((groups, item) => {
    (groups[key(item)] ||= []).push(item);
    return groups;
  }, {} as Record<K, T[]>);

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
}

export const clampZoom = (value: number) => {return clamp(value, 0.1, 10);}

export const formatShutterSpeedRational = (shutter: number): [number, number] => {
  if(shutter < 1) {
    return [1, Math.round(1/shutter)];
  }
  return [Math.round(shutter), 1];
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

export const roundAccurate = (val: number, decimals: number = 2) => {
  const factor = Math.pow(10, decimals);
  return Math.round((val + Number.EPSILON) * factor) / factor;
}