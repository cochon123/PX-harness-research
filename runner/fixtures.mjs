function el(uid, tag, options = {}, children = []) {
  return {
    uid,
    tag,
    id: options.id || null,
    classes: options.classes || [],
    role: options.role || null,
    attrs: options.attrs || {},
    text: options.text || "",
    style: options.style || {},
    bounds: options.bounds || { width: 120, height: 32 },
    children
  };
}

export const pages = {
  dashboard: {
    id: "dashboard",
    url: "https://fixture.local/dashboard",
    hostname: "fixture.local",
    pathname: "/dashboard",
    title: "Acme Ops Dashboard",
    root: el("dashboard-root", "main", { id: "app", classes: ["dashboard-shell"], role: "main" }, [
      el("promo-banner", "section", {
        classes: ["promo", "surface"],
        attrs: { "data-testid": "promo-banner", "aria-label": "Upgrade promotion" },
        text: "Upgrade today to unlock forecasts",
        bounds: { width: 760, height: 88 }
      }, [
        el("promo-banner-copy", "p", {
          classes: ["promo-copy"],
          text: "Upgrade today to unlock forecasts",
          bounds: { width: 420, height: 24 }
        })
      ]),
      el("kpi-grid", "section", { classes: ["kpi-grid"], attrs: { "data-testid": "kpi-grid" } }, [
        el("revenue-card", "article", {
          classes: ["metric-card", "primary"],
          attrs: { "data-testid": "revenue-card" },
          text: "Revenue $128k",
          bounds: { width: 240, height: 160 }
        }, [
          el("revenue-title", "h2", { classes: ["metric-title"], text: "Revenue" }, [
            el("revenue-title-text", "span", { classes: ["metric-title-text"], text: "Revenue" })
          ]),
          el("revenue-value", "p", { classes: ["metric-value"], text: "$128k" })
        ]),
        el("churn-card", "article", {
          classes: ["metric-card"],
          attrs: { "data-testid": "churn-card" },
          text: "Churn 4.2%",
          bounds: { width: 240, height: 160 }
        }, [
          el("churn-title", "h2", { classes: ["metric-title"], text: "Churn" }, [
            el("churn-title-text", "span", { classes: ["metric-title-text"], text: "Churn" })
          ])
        ]),
        el("latency-card", "article", {
          classes: ["metric-card"],
          attrs: { "data-testid": "latency-card" },
          text: "Latency 182ms",
          bounds: { width: 240, height: 160 }
        }, [
          el("latency-title", "h2", { classes: ["metric-title"], text: "Latency" }, [
            el("latency-title-text", "span", { classes: ["metric-title-text"], text: "Latency" })
          ])
        ])
      ])
    ])
  },

  "docs-home": {
    id: "docs-home",
    url: "https://fixture.local/docs",
    hostname: "fixture.local",
    pathname: "/docs",
    title: "Docs Home",
    root: el("docs-root", "main", { id: "docs-homescreen", classes: ["docs-homescreen"], role: "main" }, [
      el("toolbar", "header", { classes: ["docs-header"], text: "Start a new document" }, [
        el("blank-document-button", "button", {
          classes: ["docs-new-document"],
          role: "button",
          attrs: { "aria-label": "Blank document", "data-testid": "blank-document-button" },
          text: "Blank document"
        })
      ]),
      el("template-gallery", "section", {
        classes: ["docs-homescreen-item-section", "docs-template-gallery"],
        role: "region",
        attrs: { "aria-labelledby": "template-gallery-label" },
        text: "Template gallery Blank Resume Project proposal"
      }, [
        el("template-gallery-title", "h2", {
          id: "template-gallery-label",
          classes: ["docs-homescreen-section-title"],
          text: "Template gallery"
        }),
        el("template-gallery-list", "div", {
          classes: ["docs-homescreen-item-grid"],
          role: "listbox",
          attrs: { tabindex: "0", "aria-labelledby": "template-gallery-label" },
          text: "Blank Resume Project proposal"
        })
      ]),
      el("recent-docs-list", "section", {
        classes: ["docs-recent-list"],
        role: "list",
        attrs: { "aria-label": "Recent documents" },
        text: "Recent documents Quarterly plan Team notes"
      })
    ])
  },

  "youtube-feed": {
    id: "youtube-feed",
    url: "https://fixture.local/youtube",
    hostname: "fixture.local",
    pathname: "/youtube",
    title: "FixtureTube",
    root: el("youtube-root", "body", { classes: ["fixturetube"], text: "FixtureTube" }, [
      el("feed-root", "main", {
        id: "contents",
        classes: ["ytd-rich-grid-renderer"],
        role: "main",
        attrs: { "data-testid": "feed-root" },
        text: "Backyard Squirrel Maze Engineering a rocket Perfect pasta Phone awards"
      }, [
        el("video-first-card", "article", {
          classes: ["ytd-rich-item-renderer", "video-card"],
          attrs: { "data-channel": "Nature Lab" },
          text: "Backyard Squirrel Maze Nature Lab"
        }, [
          el("video-first-link", "a", { id: "video-title", classes: ["yt-simple-endpoint"], text: "Backyard Squirrel Maze" }),
          el("video-first-channel", "a", { classes: ["channel-name"], text: "Nature Lab" })
        ]),
        el("video-mark-rober-card", "article", {
          classes: ["ytd-rich-item-renderer", "video-card"],
          attrs: { "data-channel": "Mark Rober" },
          text: "World's Smallest Nerf Gun Mark Rober"
        }, [
          el("video-mark-rober-link", "a", { id: "video-title-link", classes: ["yt-simple-endpoint"], text: "World's Smallest Nerf Gun" }),
          el("video-mark-rober-channel", "a", { classes: ["channel-name"], attrs: { "aria-label": "Mark Rober channel" }, text: "Mark Rober" })
        ]),
        el("video-cooking-card", "article", {
          classes: ["ytd-rich-item-renderer", "video-card"],
          attrs: { "data-channel": "Kitchen Daily" },
          text: "Perfect pasta Kitchen Daily"
        }, [
          el("video-cooking-channel", "a", { classes: ["channel-name"], text: "Kitchen Daily" })
        ]),
        el("video-rocket-card", "article", {
          classes: ["ytd-rich-item-renderer", "video-card"],
          attrs: { "data-channel": "Everyday Astronaut" },
          text: "Engineering a rocket Everyday Astronaut"
        }, [
          el("video-rocket-channel", "a", { classes: ["channel-name"], text: "Everyday Astronaut" })
        ]),
        el("video-mkbhd-card", "article", {
          classes: ["ytd-rich-item-renderer", "video-card"],
          attrs: { "data-channel": "Marques Brownlee" },
          text: "Phone awards Marques Brownlee"
        }, [
          el("video-mkbhd-channel", "a", { classes: ["channel-name"], text: "Marques Brownlee" })
        ])
      ])
    ])
  }
};

export function flatten(root, parent = null, depth = 0, out = []) {
  const node = { ...root, parent, depth };
  out.push(node);
  for (const child of root.children || []) {
    flatten(child, node, depth + 1, out);
  }
  return out;
}

export function getPage(pageId) {
  const page = pages[pageId];
  if (!page) throw new Error(`Unknown page ${pageId}`);
  const nodes = flatten(page.root);
  return { ...page, nodes };
}

