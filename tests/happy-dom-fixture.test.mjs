import { describe, expect, it } from "vitest";
import { getPage } from "../runner/fixtures.mjs";
import { querySelectorAllSubset } from "../runner/selector-engine.mjs";

describe("happy-dom fixture checks", () => {
  it("keeps native selector behavior aligned with the harness selector subset", () => {
    const page = getPage("youtube-feed");
    document.body.innerHTML = renderNode(page.root);

    const selectors = [
      "article.video-card",
      "article[data-channel=\"Mark Rober\"]",
      "[data-sponsored=\"true\"] .sponsor-badge",
      "main > article:nth-of-type(6)"
    ];

    for (const selector of selectors) {
      const nativeUids = Array.from(document.querySelectorAll(selector)).map((node) => node.dataset.uid);
      const subsetUids = querySelectorAllSubset(page, selector).map((node) => node.uid);
      expect(subsetUids).toEqual(nativeUids);
    }
  });
});

function renderNode(node) {
  const attrs = [
    ["data-uid", node.uid],
    ["id", node.id],
    ["class", node.classes?.join(" ")],
    ["role", node.role],
    ...Object.entries(node.attrs || {})
  ]
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
    .join(" ");
  const children = (node.children || []).map(renderNode).join("");
  return `<${node.tag}${attrs ? ` ${attrs}` : ""}>${escapeHtml(node.text || "")}${children}</${node.tag}>`;
}

function escapeAttribute(value) {
  return escapeHtml(String(value)).replace(/"/g, "&quot;");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
