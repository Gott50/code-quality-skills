// Dead code: this whole file is imported by nothing — no test, no source module.
export function reverseString(input: string): string {
  let reversed = "";
  for (let index = input.length - 1; index >= 0; index -= 1) {
    reversed += input[index];
  }
  return reversed;
}

export const UNUSED_LIMIT = 42;
