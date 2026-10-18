// Conventional Commits, enforced by the commit-msg hook and by the gate.
//
// The preset is the shape the release workflow's changelog and version
// derivation reads: a type, an optional scope, and a subject. A message that
// does not parse is rejected before it is written, so the derivation never has
// to guess at a message it cannot classify.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // The subject is what the changelog prints, so it is capped at the width a
    // changelog line can carry without wrapping.
    "header-max-length": [2, "always", 72],
  },
};
