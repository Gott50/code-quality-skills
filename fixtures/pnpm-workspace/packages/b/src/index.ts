export interface Bucket {
  label: string;
  count: number;
}

export function summarise(buckets: Bucket[]): string {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return `${buckets.length} buckets, ${total} items`;
}
