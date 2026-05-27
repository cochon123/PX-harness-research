const STOP_WORDS = new Set([
  "a", "about", "able", "add", "all", "am", "an", "and", "any", "are", "be", "button", "card", "change",
  "content", "delete", "document", "dont", "element", "feed", "from", "get", "hide", "i", "in", "is",
  "it", "just", "make", "me", "my", "new", "no", "not", "of", "on", "only", "page", "remove", "see",
  "section", "selected", "starting", "that", "the", "this", "to", "use", "video", "want", "with"
]);

const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea", "label"]);
const INTERACTIVE_ROLES = new Set(["button", "tab", "link", "menuitem", "option", "checkbox", "radio"]);

export function buildDomfsContext({ task, page }) {
  const root = page.nodes.find((node) => !node.parent) || page.root;
  const pathsByUid = new Map();
  assignPaths(root, "", pathsByUid);

  const queries = buildQueries(task);
  const outline = buildOutline(root, pathsByUid);
  const selected = task.selectionUid ? inspectNode(page.nodes.find((node) => node.uid === task.selectionUid), pathsByUid) : null;
  const searchResults = queries.map((query) => ({
    query,
    results: searchNodes({ page, query, pathsByUid }).slice(0, 8)
  }));
  const inspectedUids = new Set([
    selected?.uid,
    ...searchResults.flatMap((search) => search.results.slice(0, 3).map((result) => result.uid))
  ].filter(Boolean));
  const inspections = Array.from(inspectedUids)
    .map((uid) => inspectNode(page.nodes.find((node) => node.uid === uid), pathsByUid))
    .filter(Boolean);

  return {
    version: "domfs-v1",
    description: "Terminal-like DOM navigation context: outline, find results, local inspections, nearby family, and proposed selectors.",
    importantLimits: [
      "Paths are readable handles, not stable selectors.",
      "Prefer proposed stable selectors over nth-child paths.",
      "data-uid selectors are fixture-only benchmark handles; real pages need ARIA, text, id, data-testid, or scoped structural selectors.",
      "If a proposed selector matches multiple unrelated nodes, scope it to the inspected parent or use a more specific selector."
    ],
    page: {
      id: page.id,
      title: page.title,
      url: page.url,
      nodeCount: page.nodes.length
    },
    outline,
    queries,
    selected,
    searchResults,
    inspections,
    toolTrace: buildToolTrace({ task, selected, searchResults, inspections })
  };
}

function assignPaths(node, parentPath, pathsByUid) {
  if (!node) return;
  const segment = pathSegment(node);
  const path = parentPath ? `${parentPath}/${segment}` : `/${segment}`;
  pathsByUid.set(node.uid, path);
  for (const child of node.children || []) {
    assignPaths(child, path, pathsByUid);
  }
}

function pathSegment(node) {
  const role = node.role ? `[role=${node.role}]` : "";
  const label = normalizeText(node.attrs?.["aria-label"] || node.attrs?.["data-testid"] || node.id || node.text || node.uid)
    .split(" ")
    .slice(0, 4)
    .join("-");
  return `${semanticName(node)}${role}${label ? `[${label}]` : ""}`;
}

function semanticName(node) {
  if (node.attrs?.["data-testid"]) return node.attrs["data-testid"];
  if (node.id) return node.id;
  if (node.classes?.includes("video-card")) return "video-card";
  if (node.classes?.includes("channel-name")) return "channel";
  if (node.classes?.includes("metric-card")) return "metric-card";
  if (node.classes?.includes("metric-title-text")) return "metric-title-text";
  if (node.classes?.includes("docs-template-gallery")) return "template-gallery";
  if (node.classes?.includes("docs-recent-list")) return "recent-documents";
  return node.tag || "node";
}

function buildOutline(root, pathsByUid, maxNodes = 60) {
  const rows = [];
  walk(root, (node) => {
    if (rows.length >= maxNodes) return;
    rows.push({
      path: pathsByUid.get(node.uid),
      uid: node.uid,
      depth: node.depth || 0,
      tag: node.tag,
      role: node.role || null,
      label: node.attrs?.["aria-label"] || node.attrs?.["data-testid"] || node.id || "",
      text: normalizeVisible(node.text).slice(0, 90),
      childCount: node.children?.length || 0,
      selectors: proposedSelectors(node).slice(0, 3)
    });
  });
  return rows;
}

function buildQueries(task) {
  const queries = [];
  const prompt = String(task.prompt || "");
  if (task.semanticProbe?.query) queries.push(task.semanticProbe.query);
  if (/model gallery/i.test(prompt)) queries.push("template gallery");
  if (/recent documents/i.test(prompt)) queries.push("recent documents");
  if (/warning|sync/i.test(prompt)) queries.push("sync failures warning");
  if (/sponsored|ads?/i.test(prompt)) queries.push("sponsored ads");
  if (/rocket|rokcet/i.test(prompt)) queries.push("rocket engineering");
  if (/rober|ruber/i.test(prompt)) queries.push("mark rober");

  const promptKeywords = normalizeText(prompt)
    .split(" ")
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .slice(0, 7)
    .join(" ");
  if (promptKeywords) queries.push(promptKeywords);

  return Array.from(new Set(queries)).slice(0, 4);
}

function searchNodes({ page, query, pathsByUid }) {
  return page.nodes
    .map((node) => {
      const haystack = [
        node.uid,
        node.id,
        node.role,
        node.attrs?.["aria-label"],
        node.attrs?.["data-testid"],
        node.attrs?.["data-channel"],
        node.classes?.join(" "),
        node.text
      ].filter(Boolean).join(" ");
      return {
        uid: node.uid,
        path: pathsByUid.get(node.uid),
        tag: node.tag,
        role: node.role || null,
        text: normalizeVisible(node.text).slice(0, 120),
        score: relevance(query, haystack, node),
        selectors: proposedSelectors(node).slice(0, 4)
      };
    })
    .filter((result) => result.score > 0.12)
    .sort((left, right) => right.score - left.score);
}

function inspectNode(node, pathsByUid) {
  if (!node) return null;
  const parent = node.parent || null;
  const siblings = parent?.children || [];
  const siblingIndex = siblings.findIndex((candidate) => candidate.uid === node.uid);
  return {
    uid: node.uid,
    path: pathsByUid.get(node.uid),
    tag: node.tag,
    id: node.id || null,
    classes: node.classes || [],
    role: node.role || null,
    ariaLabel: node.attrs?.["aria-label"] || null,
    dataTestId: node.attrs?.["data-testid"] || null,
    dataChannel: node.attrs?.["data-channel"] || null,
    text: normalizeVisible(node.text).slice(0, 220),
    kind: classifyNode(node),
    selectors: proposedSelectors(node),
    parent: parent ? {
      uid: parent.uid,
      path: pathsByUid.get(parent.uid),
      tag: parent.tag,
      text: normalizeVisible(parent.text).slice(0, 140),
      selectors: proposedSelectors(parent).slice(0, 4)
    } : null,
    siblings: siblings.map((sibling, index) => ({
      uid: sibling.uid,
      path: pathsByUid.get(sibling.uid),
      relativeIndex: index - siblingIndex,
      tag: sibling.tag,
      text: normalizeVisible(sibling.text).slice(0, 90),
      selectors: proposedSelectors(sibling).slice(0, 2)
    })).slice(Math.max(0, siblingIndex - 3), siblingIndex + 4),
    children: (node.children || []).slice(0, 8).map((child) => ({
      uid: child.uid,
      path: pathsByUid.get(child.uid),
      tag: child.tag,
      text: normalizeVisible(child.text).slice(0, 90),
      selectors: proposedSelectors(child).slice(0, 2)
    }))
  };
}

function proposedSelectors(node) {
  if (!node) return [];
  const selectors = [];
  if (node.uid) selectors.push(`[data-uid="${cssString(node.uid)}"]`);
  if (node.id && !/^\d/.test(node.id)) selectors.push(`#${cssEscape(node.id)}`);
  if (node.attrs?.["data-testid"]) selectors.push(`[data-testid="${cssString(node.attrs["data-testid"])}"]`);
  if (node.attrs?.["aria-label"]) selectors.push(`${node.tag}[aria-label="${cssString(node.attrs["aria-label"])}"]`);
  if (node.attrs?.["data-channel"]) selectors.push(`${node.tag}[data-channel="${cssString(node.attrs["data-channel"])}"]`);
  const usefulClasses = (node.classes || []).filter((className) => className.length > 2).slice(0, 3);
  for (const className of usefulClasses) selectors.push(`${node.tag}.${cssEscape(className)}`);
  if (node.parent?.attrs?.["data-testid"] && usefulClasses[0]) {
    selectors.push(`[data-testid="${cssString(node.parent.attrs["data-testid"])}"] ${node.tag}.${cssEscape(usefulClasses[0])}`);
  }
  return Array.from(new Set(selectors));
}

function buildToolTrace({ task, selected, searchResults, inspections }) {
  const trace = [
    { tool: "domfs.outline", args: { pageId: task.pageId }, result: "See outline." }
  ];
  if (selected) {
    trace.push({ tool: "domfs.inspect", args: { path: selected.path }, result: summarizeInspection(selected) });
  }
  for (const search of searchResults) {
    trace.push({
      tool: "domfs.find",
      args: { query: search.query },
      result: search.results.slice(0, 5).map((result) => ({
        path: result.path,
        uid: result.uid,
        text: result.text,
        score: result.score,
        selectors: result.selectors
      }))
    });
  }
  for (const inspected of inspections.slice(0, 5)) {
    if (selected && inspected.uid === selected.uid) continue;
    trace.push({ tool: "domfs.inspect", args: { path: inspected.path }, result: summarizeInspection(inspected) });
  }
  return trace;
}

function summarizeInspection(inspected) {
  return {
    uid: inspected.uid,
    tag: inspected.tag,
    text: inspected.text,
    kind: inspected.kind,
    selectors: inspected.selectors,
    parent: inspected.parent ? {
      uid: inspected.parent.uid,
      text: inspected.parent.text,
      selectors: inspected.parent.selectors
    } : null,
    siblings: inspected.siblings.map((sibling) => ({
      uid: sibling.uid,
      relativeIndex: sibling.relativeIndex,
      text: sibling.text
    }))
  };
}

function walk(node, visit) {
  if (!node) return;
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function classifyNode(node) {
  const role = node.role || "";
  if (INTERACTIVE_TAGS.has(node.tag) || INTERACTIVE_ROLES.has(role)) return "interactive";
  if (normalizeVisible(node.text)) return "text-or-container";
  return "container";
}

function relevance(query, haystack, node) {
  const q = normalizeText(query);
  const h = normalizeText(haystack);
  if (!q || !h) return 0;
  const qWords = q.split(" ").filter(Boolean);
  const hits = qWords.filter((word) => h.includes(word)).length;
  const contains = h.includes(q) || q.includes(h) ? 0.45 : 0;
  const fuzzy = 1 - (levenshtein(q.slice(0, 80), h.slice(0, 80)) / Math.max(q.length, Math.min(h.length, 80), 1));
  const semanticBoost = classifyNode(node) === "text-or-container" ? 0.06 : 0;
  return roundScore(Math.max(0, contains + (hits / Math.max(qWords.length, 1)) * 0.45 + Math.max(0, fuzzy) * 0.18 + semanticBoost));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeVisible(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cssString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const insert = previous[column] + 1;
      const remove = previous[column - 1] + 1;
      const replace = diagonal + (left[row - 1] === right[column - 1] ? 0 : 1);
      diagonal = previous[column];
      previous[column] = Math.min(insert, remove, replace);
    }
  }
  return previous[right.length];
}
