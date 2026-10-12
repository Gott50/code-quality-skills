// frontmatter.mjs — the strict-subset frontmatter reader (RECIPE-CONTRACT.md → "Reader rules").
//
// Shared by detect.mjs (which reads every recipe's frontmatter to evaluate `when`) and by the
// repo-root scripts/build-library.mjs (which reads the same frontmatter to emit library.json).
// Zero dependencies, node builtins only. The parsing behavior is fixed by the contract; this
// module is the single copy of it.

// Flow-style values are JSON with the quotes left off. Quote the bare tokens, then JSON.parse.
function parseFlow(src) {
  const quoted = src
    .replace(/([{,]\s*)([A-Za-z_][\w.-]*)\s*:/g, '$1"$2":')
    .replace(/:\s*([^"'\s,[\]{}][^,}\]]*?)\s*(?=[,}])/g, (_m, w) => `: ${JSON.stringify(w)}`)
    .replace(
      /([[,]\s*)([^"'\s,[\]{}][^,}\]]*?)\s*(?=[,\]])/g,
      (_m, p, w) => `${p}${JSON.stringify(w)}`,
    );
  try {
    return JSON.parse(quoted);
  } catch (err) {
    throw new Error(`frontmatter: unreadable flow value ${JSON.stringify(src)} — ${err.message}`);
  }
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (s.startsWith("[") || s.startsWith("{")) return parseFlow(s);
  return s;
}

export function parseFrontmatter(text, label) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) throw new Error(`${label}: no --- frontmatter block`);
  const lines = m[1].split(/\r?\n/);
  const indentOf = (l) => l.match(/^ */)[0].length;
  let i = 0;

  const skipBlank = () => {
    while (i < lines.length && lines[i].trim() === "") i++;
  };

  function parseNode(minIndent) {
    skipBlank();
    if (i >= lines.length) return null;
    const ind = indentOf(lines[i]);
    if (ind < minIndent) return null;
    return /^\s*-\s/.test(lines[i]) ? parseSeq(ind) : parseMap(ind);
  }

  function parseSeq(indent) {
    const out = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        i++;
        continue;
      }
      if (indentOf(line) !== indent || !/^\s*-\s/.test(line)) break;
      const rest = line.slice(indent + 1).trim();
      if (rest === "") {
        i++;
        out.push(parseNode(indent + 1));
        continue;
      }
      if (/^[A-Za-z_][\w-]*\s*:/.test(rest)) {
        // "- key: value" — the map's own lines sit two columns deeper.
        lines[i] = " ".repeat(indent + 2) + rest;
        out.push(parseMap(indent + 2));
        continue;
      }
      out.push(parseScalar(rest));
      i++;
    }
    return out;
  }

  function parseMap(indent) {
    const out = {};
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        i++;
        continue;
      }
      if (indentOf(line) !== indent) break;
      const mm = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
      if (!mm) throw new Error(`${label}: line outside the strict subset: ${JSON.stringify(line)}`);
      const [, key, rawVal] = mm;
      if (rawVal.trim() === "") {
        i++;
        out[key] = parseNode(indent + 1);
      } else {
        out[key] = parseScalar(rawVal);
        i++;
      }
    }
    return out;
  }

  const root = parseMap(0);
  skipBlank();
  if (i < lines.length) {
    throw new Error(`${label}: line outside the strict subset: ${JSON.stringify(lines[i])}`);
  }
  return root;
}
