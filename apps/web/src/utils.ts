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
//Colors for Mixed Colors in Color adjustements
export const COLORS = [
    { 
        id: 'mixRed', 
        hex: '#FF3B30', 
        hueGradient: 'linear-gradient(to right, hsl(260, 50%, 50%), hsl(0, 50%, 50%), hsl(100, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(0, 0%, 50%), hsl(0, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(0, 100%, 0%), hsl(0, 100%, 50%), hsl(0, 100%, 100%))'
    },
    { 
        id: 'mixOrange', 
        hex: '#FF9500', 
        hueGradient: 'linear-gradient(to right, hsl(290, 50%, 50%), hsl(30, 50%, 50%), hsl(130, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(30, 0%, 50%), hsl(30, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(30, 100%, 0%), hsl(30, 100%, 50%), hsl(30, 100%, 100%))'
    },
    { 
        id: 'mixYellow', 
        hex: '#FFCC00', 
        hueGradient: 'linear-gradient(to right, hsl(320, 50%, 50%), hsl(60, 50%, 50%), hsl(160, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(60, 0%, 50%), hsl(60, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(60, 100%, 0%), hsl(60, 100%, 50%), hsl(60, 100%, 100%))'
    },
    { 
        id: 'mixGreen', 
        hex: '#34C759', 
        hueGradient: 'linear-gradient(to right, hsl(20, 50%, 50%), hsl(120, 50%, 50%), hsl(220, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(120, 0%, 50%), hsl(120, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(120, 100%, 0%), hsl(120, 100%, 50%), hsl(120, 100%, 100%))'
    },
    { 
        id: 'mixCyan', 
        hex: '#32ADE6', 
        hueGradient: 'linear-gradient(to right, hsl(80, 50%, 50%), hsl(180, 50%, 50%), hsl(280, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(180, 0%, 50%), hsl(180, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(180, 100%, 0%), hsl(180, 100%, 50%), hsl(180, 100%, 100%))'
    },
    { 
        id: 'mixBlue', 
        hex: '#007AFF', 
        hueGradient: 'linear-gradient(to right, hsl(140, 50%, 50%), hsl(240, 50%, 50%), hsl(340, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(240, 0%, 50%), hsl(240, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(240, 100%, 0%), hsl(240, 100%, 50%), hsl(240, 100%, 100%))'
    },
    { 
        id: 'mixPurple', 
        hex: '#AF52DE', 
        hueGradient: 'linear-gradient(to right, hsl(200, 50%, 50%), hsl(300, 50%, 50%), hsl(40, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(285, 0%, 50%), hsl(285, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(285, 100%, 0%), hsl(285, 100%, 50%), hsl(285, 100%, 100%))'
    },
    { 
        id: 'mixMagenta', 
        hex: '#FF2D55', 
        hueGradient: 'linear-gradient(to right, hsl(240, 50%, 50%), hsl(340, 50%, 50%), hsl(80, 50%, 50%))',
        satGradient: 'linear-gradient(to right, hsl(315, 0%, 50%), hsl(315, 100%, 50%))',
        lumGradient: 'linear-gradient(to right, hsl(315, 100%, 0%), hsl(315, 100%, 50%), hsl(315, 100%, 100%))'
    },
];

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