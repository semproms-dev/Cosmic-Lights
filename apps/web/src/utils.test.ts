import { describe, expect, it } from 'vitest';
import { formatAperture, formatShutterSpeed } from './utils';

describe('formatShutterSpeed', () => {
  it('formats sub-second speeds as a 1/x fraction', () => {
    expect(formatShutterSpeed(0.004)).toBe('1/250s'); // 1/0.004 = 250
    expect(formatShutterSpeed(0.008)).toBe('1/125s'); // 1/0.008 = 125
    expect(formatShutterSpeed(0.5)).toBe('1/2s');
  });

  it('rounds the denominator to the nearest integer', () => {
    // 1 / 0.0166 ≈ 60.24 → 60
    expect(formatShutterSpeed(1 / 60)).toBe('1/60s');
  });

  it('formats one second and slower as whole seconds', () => {
    expect(formatShutterSpeed(1)).toBe('1s');
    expect(formatShutterSpeed(2)).toBe('2s');
    expect(formatShutterSpeed(1.5)).toBe('2s'); // Math.round(1.5) = 2
  });
});

describe('formatAperture', () => {
  it('renders the f-number with one decimal place', () => {
    expect(formatAperture(2.8)).toBe('f/2.8');
    expect(formatAperture(4)).toBe('f/4.0');
    expect(formatAperture(1.7999)).toBe('f/1.8');
  });
});
