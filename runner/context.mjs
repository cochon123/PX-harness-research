import { getPage } from "./fixtures.mjs";

const DECORATIVE_CLASS_PATTERN = /touch|feedback|ripple|overlay|shapefill|shapestroke|hitarea|skeleton|placeholder/i;
const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea", "label"]);
const INTERACTIVE_ROLES = new Set(["button", "tab", "link", "menuitem", "option", "checkbox", "radio"]);

export function buildCaseContext(task) {
  const page = getPage(task.pageId);
  const pageContext = {
    url: page.url,
    hostname: page.hostname,
    pathname: page.pathname,
    title: page.title,
    viewport: { width: 1280, height: 800 }
  };

  const pageDom = {
    ...pageContext,
    nodeCount: page.nodes.length,
    nodes: page.nodes.slice(0, 220).map((node) => ({
      depth: node.depth,
      tag: node.tag,
      id: node.id,
      classes: node.classes.slice(0, 4),
      role: node.role,
      ariaLabel: node.attrs?.["aria-label"] || null,
      text: normalizeText(node.text).slice(0, 80),
      childCount: node.children?.length || 0,
      bounds: node.bounds || { width: 120, height: 32 }
    }))
  };

  const selections = task.selectionUid
    ? [buildSelection(page.nodes.find((node) => node.uid === task.selectionUid), `sel_${task.id}`, page.nodes)]
    : [];

  return { page, pageContext, pageDom, selections };
}

function buildSelection(node, selectionId, nodes) {
  if (!node) throw new Error(`Missing selected node for ${selectionId}`);
  const hierarchyCandidates = [];
  let current = node;
  let levelsUp = 0;

  while (current && levelsUp <= 5) {
    const profile = profileNode(current);
    hierarchyCandidates.push({
      levelsUp,
      tag: current.tag,
      id: current.id,
      classes: current.classes.slice(0, 6),
      role: current.role,
      ariaLabel: current.attrs?.["aria-label"] || null,
      text: normalizeText(current.text).slice(0, 120),
      elementKind: profile.kind,
      isDecorative: profile.isDecorative,
      isInteractive: profile.isInteractive,
      hasVisibleText: profile.hasVisibleText,
      selectorHints: buildSelectorHints(current).slice(0, 4)
    });
    current = current.parent;
    levelsUp += 1;
  }

  const semanticTarget = hierarchyCandidates
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate) }))
    .sort((left, right) => right.score - left.score)[0];

  const siblings = nodes.filter((candidate) => candidate.parent?.uid === node.parent?.uid);
  const index = siblings.findIndex((candidate) => candidate.uid === node.uid);

  return {
    id: selectionId,
    tag: node.tag,
    idAttr: node.id,
    classes: node.classes.slice(0, 8),
    role: node.role,
    ariaLabel: node.attrs?.["aria-label"] || null,
    title: node.attrs?.title || null,
    href: node.attrs?.href || null,
    text: normalizeText(node.text).slice(0, 240),
    elementKind: profileNode(node).kind,
    bounds: { x: 0, y: 0, width: node.bounds?.width || 120, height: node.bounds?.height || 32 },
    computedStyle: {
      display: node.style.display || "block",
      color: node.style.color || "rgb(33, 33, 33)",
      backgroundColor: node.style.backgroundColor || "rgba(0, 0, 0, 0)",
      fontSize: node.style.fontSize || "16px",
      fontFamily: node.style.fontFamily || "Arial",
      borderRadius: node.style.borderRadius || "0px"
    },
    outerHTML: summarizeHtml(node),
    ancestorChain: hierarchyCandidates.slice(1).map((candidate) => ({
      tag: candidate.tag,
      id: candidate.id,
      classes: candidate.classes,
      role: candidate.role,
      ariaLabel: candidate.ariaLabel
    })),
    hierarchyCandidates,
    semanticTarget: semanticTarget ? {
      levelsUp: semanticTarget.levelsUp,
      tag: semanticTarget.tag,
      id: semanticTarget.id,
      classes: semanticTarget.classes,
      role: semanticTarget.role,
      ariaLabel: semanticTarget.ariaLabel,
      text: semanticTarget.text,
      elementKind: semanticTarget.elementKind,
      selectorHints: semanticTarget.selectorHints,
      reason: semanticTarget.levelsUp === 0
        ? "Clicked node already looks like the intended target."
        : `Parent ${semanticTarget.levelsUp} level(s) up is likely what the user meant to modify.`
    } : null,
    siblingContext: {
      index,
      total: siblings.length,
      previousText: normalizeText(siblings[index - 1]?.text || "").slice(0, 80),
      nextText: normalizeText(siblings[index + 1]?.text || "").slice(0, 80)
    },
    nearbyText: normalizeText(node.parent?.text || node.text).slice(0, 220),
    selectorHints: buildSelectorHints(node),
    fingerprint: {
      tag: node.tag,
      id: node.id,
      classes: node.classes.slice(0, 6),
      role: node.role,
      ariaLabel: node.attrs?.["aria-label"] || null,
      textSample: normalizeText(node.text).slice(0, 120),
      ancestorTags: hierarchyCandidates.slice(1, 5).map((candidate) => candidate.tag)
    }
  };
}

function profileNode(node) {
  const classJoined = node.classes.join(" ");
  const isDecorative = DECORATIVE_CLASS_PATTERN.test(classJoined) || node.attrs?.["aria-hidden"] === "true";
  const isInteractive = INTERACTIVE_TAGS.has(node.tag) || INTERACTIVE_ROLES.has(node.role || "");
  const hasVisibleText = normalizeText(node.text).length > 0 && !isDecorative;
  const kind = isInteractive ? "interactive" : hasVisibleText ? "text" : isDecorative ? "decorative" : "container";
  return { kind, isDecorative, isInteractive, hasVisibleText };
}

function scoreCandidate(candidate) {
  let score = 0;
  if (candidate.isInteractive) score += 8;
  if (candidate.hasVisibleText) score += 7;
  if (candidate.elementKind === "text") score += 6;
  if (candidate.ariaLabel) score += 4;
  if (candidate.id) score += 3;
  if (candidate.isDecorative) score -= 10;
  score -= candidate.levelsUp * 0.5;
  return score;
}

function buildSelectorHints(node) {
  const hints = [];
  if (node.id && !/^\d/.test(node.id)) hints.push(`#${cssEscape(node.id)}`);
  if (node.attrs?.["aria-label"]) hints.push(`${node.tag}[aria-label="${node.attrs["aria-label"].replace(/"/g, '\\"')}"]`);
  if (node.attrs?.["data-testid"]) hints.push(`[data-testid="${node.attrs["data-testid"].replace(/"/g, '\\"')}"]`);
  for (const className of node.classes.slice(0, 3)) {
    if (className.length > 2) hints.push(`${node.tag}.${cssEscape(className)}`);
  }
  return Array.from(new Set(hints)).slice(0, 8);
}

function summarizeHtml(node) {
  const attrs = [
    node.id ? `id="${node.id}"` : "",
    node.classes.length ? `class="${node.classes.join(" ")}"` : "",
    ...Object.entries(node.attrs || {}).map(([key, value]) => `${key}="${String(value).replace(/"/g, "&quot;")}"`)
  ].filter(Boolean).join(" ");
  return `<${node.tag}${attrs ? ` ${attrs}` : ""}>${normalizeText(node.text).slice(0, 200)}</${node.tag}>`;
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

