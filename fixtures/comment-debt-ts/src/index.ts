// The retry budget is a count of attempts, not a duration: the upstream
// rate-limits per minute, so a duration would let a burst through and a
// count keeps the worst case bounded. The backoff below multiplies this
// by the attempt number, which is why the first retry waits one second.
export function retryBudget(): number {
  return 3;
}
