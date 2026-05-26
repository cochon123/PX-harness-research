import { pages } from "../../runner/fixtures.mjs";

export function renderPage(pageId) {
  const page = pages[pageId];
  if (!page) return null;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(page.title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f4ee;
        --ink: #211f1b;
        --muted: #676157;
        --panel: #ffffff;
        --line: #d8d0c0;
        --accent: #0f766e;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 180vh;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--ink);
        background: var(--bg);
      }
      main, section, article, header {
        display: block;
      }
      .fixture-shell {
        width: min(1120px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 80px;
      }
      .dashboard-shell, .docs-homescreen, .fixturetube {
        width: min(1120px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 80px;
      }
      .promo {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #e8f4f1;
        padding: 20px;
        margin-bottom: 20px;
      }
      .promo-copy {
        margin: 0;
        font-size: 1.05rem;
      }
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
      }
      .metric-card {
        min-height: 160px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        padding: 18px;
      }
      .metric-card.primary {
        border-color: #9ac8c1;
      }
      .warning-card {
        grid-column: 1 / -1;
        border-color: #f59e0b;
        background: #fff7ed;
      }
      .metric-title {
        margin: 0 0 18px;
        font-size: 1.05rem;
      }
      .metric-value {
        margin: 0;
        font-size: 2rem;
        font-weight: 800;
      }
      .docs-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 0;
      }
      .docs-new-document {
        border: 1px solid #183a37;
        border-radius: 6px;
        background: #183a37;
        color: #fff;
        padding: 10px 14px;
        font: inherit;
      }
      .docs-template-gallery, .docs-recent-list {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        padding: 18px;
        margin: 16px 0;
      }
      .docs-homescreen-item-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        padding-top: 8px;
      }
      .docs-homescreen-item-grid::before,
      .docs-homescreen-item-grid::after {
        content: "";
        display: block;
        min-height: 90px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #f8fafc;
      }
      #contents {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      .video-card {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        min-height: 180px;
        padding: 16px;
      }
      .video-card::before {
        content: "";
        display: block;
        height: 96px;
        margin-bottom: 12px;
        border-radius: 6px;
        background: linear-gradient(135deg, #cbd5e1, #64748b);
      }
      .video-card a {
        display: block;
        color: #183a37;
        text-decoration: none;
      }
      .channel-name {
        margin-top: 8px;
        color: var(--muted) !important;
        font-size: 0.92rem;
      }
      .sponsored-card {
        border-style: dashed;
      }
      .sponsor-badge {
        display: inline-block;
        margin-bottom: 8px;
        border-radius: 999px;
        background: #fef3c7;
        color: #92400e;
        padding: 2px 8px;
        font-size: 0.78rem;
        font-weight: 700;
      }
      @media (max-width: 760px) {
        .kpi-grid, #contents, .docs-homescreen-item-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    ${renderNode(page.root)}
    <script>
      window.__PX_WEB_ZOO_PAGE__ = ${JSON.stringify(pageId)};
      window.__PX_WEB_ZOO_RERENDER__ = () => {
        document.body.setAttribute("data-rerendered-at", String(Date.now()));
        const marker = document.createElement("div");
        marker.hidden = true;
        marker.setAttribute("data-uid", "rerender-marker");
        marker.textContent = "rerender marker";
        document.body.appendChild(marker);
      };
    </script>
  </body>
</html>`;
}

function renderNode(node) {
  const attrs = {
    ...node.attrs,
    id: node.id,
    class: node.classes.join(" "),
    role: node.role,
    "data-uid": node.uid
  };

  const attrText = Object.entries(attrs)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
    .join(" ");
  const children = (node.children || []).map(renderNode).join("");
  const text = node.children?.length ? "" : escapeHtml(node.text);
  return `<${node.tag}${attrText ? ` ${attrText}` : ""}>${text}${children}</${node.tag}>`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
