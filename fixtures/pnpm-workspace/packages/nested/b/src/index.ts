export function square(values: number[]): number[] {
  const squared: number[] = [];
  for (const value of values) {
    squared.push(value * value);
  }
  return squared;
}
