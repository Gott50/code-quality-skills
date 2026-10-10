export interface Greeting {
  name: string;
  excited: boolean;
}

export function greet({ name, excited }: Greeting): string {
  const suffix = excited ? "!" : ".";
  return `hello ${name}${suffix}`;
}

// Lint debt: a runtime `typeof` check, which the vendored anti-slop rules reject
// (anti-slop/no-runtime-typeof). The string branch is also never exercised.
export function describeInput(value: string | number): string {
  if (typeof value === "number") {
    return `number:${value}`;
  }
  return `string:${value}`;
}

// Complexity debt: thirteen branches, cyclomatic complexity 14 — above the
// oxlint `complexity` threshold of 10 and the shape fallow's CRAP score flags.
export function describeHttpStatus(code: number): string {
  if (code === 200) {
    return "ok";
  }
  if (code === 201) {
    return "created";
  }
  if (code === 204) {
    return "no content";
  }
  if (code === 301) {
    return "moved permanently";
  }
  if (code === 302) {
    return "found";
  }
  if (code === 304) {
    return "not modified";
  }
  if (code === 400) {
    return "bad request";
  }
  if (code === 401) {
    return "unauthorized";
  }
  if (code === 403) {
    return "forbidden";
  }
  if (code === 404) {
    return "not found";
  }
  if (code === 500) {
    return "internal server error";
  }
  if (code === 502) {
    return "bad gateway";
  }
  if (code === 503) {
    return "service unavailable";
  }
  return "unknown";
}

// Mutation debt: the tests pin only the seconds branch, so the `< 60` boundary
// mutant (`<= 60`) and every mutant in the minutes branch survive.
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m`;
}

// Dead code: exported, but nothing imports it.
export function legacyFormat(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return "unknown";
  }
  return normalized.replace(/\s+/g, "-");
}
