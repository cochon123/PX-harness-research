export function querySelectorAllSubset(page, selector) {
  const selectors = splitSelectorList(selector);
  const matches = new Set();
  for (const part of selectors) {
    for (const node of page.nodes) {
      if (matchesSelectorChain(node, tokenizeChain(part))) {
        matches.add(node);
      }
    }
  }
  return Array.from(matches);
}

export function isValidSubsetSelector(selector) {
  if (typeof selector !== "string" || !selector.trim()) return false;
  if (selector.length > 240) return false;
  if (/[{};]/.test(selector)) return false;
  try {
    splitSelectorList(selector).forEach((part) => tokenizeChain(part).filter((token) => token !== ">").forEach(parseCompound));
    return true;
  } catch (_error) {
    return false;
  }
}

function splitSelectorList(selector) {
  return splitOutside(selector, ",").map((part) => part.trim()).filter(Boolean);
}

function tokenizeChain(selector) {
  const tokens = [];
  let current = "";
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = null;

  for (const char of selector.trim()) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;

    if (bracketDepth === 0 && parenDepth === 0 && char === ">") {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(">");
      current = "";
      continue;
    }

    if (bracketDepth === 0 && parenDepth === 0 && /\s/.test(char)) {
      if (current.trim()) tokens.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function matchesSelectorChain(node, tokens) {
  if (!tokens.length) return false;
  return matchFromRight(node, tokens.length - 1, tokens);
}

function matchFromRight(node, tokenIndex, tokens) {
  if (!node) return false;
  const token = tokens[tokenIndex];

  if (token === ">") {
    return matchFromRight(node.parent, tokenIndex - 1, tokens);
  }

  if (!matchesCompound(node, token)) return false;
  if (tokenIndex === 0) return true;

  const previous = tokens[tokenIndex - 1];
  if (previous === ">") {
    return matchFromRight(node.parent, tokenIndex - 2, tokens);
  }

  let ancestor = node.parent;
  while (ancestor) {
    if (matchFromRight(ancestor, tokenIndex - 1, tokens)) return true;
    ancestor = ancestor.parent;
  }
  return false;
}

function matchesCompound(node, compound) {
  const parsed = parseCompound(compound);
  if (parsed.tag && parsed.tag !== "*" && parsed.tag.toLowerCase() !== node.tag.toLowerCase()) return false;
  if (parsed.id && parsed.id !== node.id) return false;
  for (const className of parsed.classes) {
    if (!node.classes.includes(className)) return false;
  }
  for (const attr of parsed.attrs) {
    const actual = attr.name === "id"
      ? node.id
      : attr.name === "class"
        ? node.classes.join(" ")
        : node.attrs?.[attr.name];
    if (actual === undefined || actual === null) return false;
    if (attr.operator === "=" && String(actual) !== attr.value) return false;
    if (attr.operator === "*=" && !String(actual).includes(attr.value)) return false;
    if (attr.operator === "^=" && !String(actual).startsWith(attr.value)) return false;
    if (attr.operator === "$=" && !String(actual).endsWith(attr.value)) return false;
    if (!attr.operator) continue;
  }
  if (parsed.nthOfType !== null && nthOfType(node) !== parsed.nthOfType) return false;
  if (parsed.nthChild && !matchesNthExpression(indexInParent(node), parsed.nthChild)) return false;
  for (const hasSelector of parsed.has) {
    if (!descendants(node).some((child) => matchesSelectorChain(child, tokenizeChain(hasSelector)))) return false;
  }
  return true;
}

function parseCompound(compound) {
  let rest = compound.trim();
  const parsed = { tag: null, id: null, classes: [], attrs: [], nthOfType: null, nthChild: null, has: [] };
  const tagMatch = rest.match(/^(\*|[a-zA-Z][a-zA-Z0-9_-]*)/);
  if (tagMatch) {
    parsed.tag = tagMatch[1];
    rest = rest.slice(tagMatch[0].length);
  }

  while (rest.length) {
    if (rest.startsWith("#")) {
      const match = rest.match(/^#((?:\\.|[a-zA-Z0-9_-])+)/);
      if (!match) throw new Error(`Invalid id selector ${compound}`);
      parsed.id = unescapeCss(match[1]);
      rest = rest.slice(match[0].length);
      continue;
    }

    if (rest.startsWith(".")) {
      const match = rest.match(/^\.((?:\\.|[a-zA-Z0-9_-])+)/);
      if (!match) throw new Error(`Invalid class selector ${compound}`);
      parsed.classes.push(unescapeCss(match[1]));
      rest = rest.slice(match[0].length);
      continue;
    }

    if (rest.startsWith("[")) {
      const end = rest.indexOf("]");
      if (end === -1) throw new Error(`Invalid attribute selector ${compound}`);
      const body = rest.slice(1, end).trim();
      const match = body.match(/^([a-zA-Z0-9_-]+)(?:\s*(=|\*=|\^=|\$=)\s*["']?([^"']*)["']?)?$/);
      if (!match) throw new Error(`Invalid attribute selector ${compound}`);
      parsed.attrs.push({ name: match[1], operator: match[2] || null, value: match[3] || "" });
      rest = rest.slice(end + 1);
      continue;
    }

    if (rest.startsWith(":nth-of-type(")) {
      const match = rest.match(/^:nth-of-type\((\d+)\)/);
      if (!match) throw new Error(`Invalid nth selector ${compound}`);
      parsed.nthOfType = Number(match[1]);
      rest = rest.slice(match[0].length);
      continue;
    }

    if (rest.startsWith(":nth-child(")) {
      const match = rest.match(/^:nth-child\(([^)]+)\)/);
      if (!match) throw new Error(`Invalid nth-child selector ${compound}`);
      parsed.nthChild = match[1].trim();
      rest = rest.slice(match[0].length);
      continue;
    }

    if (rest.startsWith(":has(")) {
      const inner = readPseudoFunction(rest, ":has");
      tokenizeChain(inner.value).filter((token) => token !== ">").forEach(parseCompound);
      parsed.has.push(inner.value);
      rest = rest.slice(inner.length);
      continue;
    }

    throw new Error(`Unsupported selector fragment ${rest} in ${compound}`);
  }

  return parsed;
}

function nthOfType(node) {
  if (!node.parent) return 1;
  const siblings = (node.parent.children || []).filter((child) => child.tag === node.tag);
  return siblings.findIndex((child) => child.uid === node.uid) + 1;
}

function indexInParent(node) {
  if (!node.parent) return 1;
  return (node.parent.children || []).findIndex((child) => child.uid === node.uid) + 1;
}

function matchesNthExpression(index, expression) {
  const normalized = expression.replace(/\s+/g, "").toLowerCase();
  if (/^\d+$/.test(normalized)) return index === Number(normalized);
  if (normalized === "odd") return index % 2 === 1;
  if (normalized === "even") return index % 2 === 0;
  const nPlus = normalized.match(/^n\+(\d+)$/);
  if (nPlus) return index >= Number(nPlus[1]);
  const minus = normalized.match(/^-n\+(\d+)$/);
  if (minus) return index <= Number(minus[1]);
  return false;
}

function descendants(node, out = []) {
  for (const child of node.children || []) {
    out.push(child);
    descendants(child, out);
  }
  return out;
}

function readPseudoFunction(value, name) {
  const prefix = `${name}(`;
  if (!value.startsWith(prefix)) throw new Error(`Expected ${name}`);
  let depth = 0;
  for (let index = name.length; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: value.slice(prefix.length, index),
          length: index + 1
        };
      }
    }
  }
  throw new Error(`Unclosed ${name}`);
}

function splitOutside(value, delimiter) {
  const parts = [];
  let current = "";
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = null;

  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === delimiter && bracketDepth === 0 && parenDepth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function unescapeCss(value) {
  return value.replace(/\\(.)/g, "$1");
}
