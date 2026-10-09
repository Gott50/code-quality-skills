export function double(values: number[]): number[] {
  const doubled: number[] = [];
  for (const value of values) {
    doubled.push(value * 2);
  }
  return doubled;
}
