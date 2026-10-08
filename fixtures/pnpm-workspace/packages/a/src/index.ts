export interface Range {
  min: number;
  max: number;
}

export function clamp(value: number, { min, max }: Range): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
