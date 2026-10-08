export interface Greeting {
  name: string;
  excited: boolean;
}

export function greet({ name, excited }: Greeting): string {
  const suffix = excited ? "!" : ".";
  return `hello ${name}${suffix}`;
}
