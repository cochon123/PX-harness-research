import { readFileSync, existsSync } from "node:fs";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

export const ALLOWED_STYLE_KEYS = [
  "background",
  "backgroundColor",
  "backgroundImage",
  "backgroundSize",
  "backgroundPosition",
  "backgroundRepeat",
  "backgroundAttachment",
  "border",
  "borderBottom",
  "borderColor",
  "borderTop",
  "borderRadius",
  "boxShadow",
  "color",
  "display",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "gap",
  "lineHeight",
  "margin",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginTop",
  "maxWidth",
  "opacity",
  "outline",
  "overflow",
  "padding",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "transform",
  "aspectRatio"
];

const TRANSFORM_SCHEMA_HINT = {
  version: "2.0",
  site: { hostname: "example.com", pathname: "/", urlPattern: "example.com/*" },
  sourcePrompt: "Make the selected chip label red",
  selections: [{ id: "sel_1", tag: "div", text: "Revenue" }],
  targetMap: {
    selected_label: {
      source: "selection",
      selectionRef: "sel_1",
      selectors: ["[data-testid=\"revenue-card\"] .metric-title-text"],
      fallbackSelectors: [".metric-card.primary .metric-title-text"]
    }
  },
  rules: [{ id: "green-label", type: "style", targetRef: "selected_label", styles: { color: "green" } }]
};

export async function generateTransformPlan({
  prompt,
  pageContext,
  pageDom,
  selections,
  reasoningMode,
  model = DEFAULT_MODEL
}) {
  const apiKey = loadOpenRouterKey();
  const messages = buildMessages({ prompt, pageContext, pageDom, selections });
  const body = {
    model,
    messages,
    temperature: 0.35,
    response_format: { type: "json_object" }
  };

  if (reasoningMode === "low") {
    body.reasoning = { enabled: true, effort: "low", exclude: true };
  }

  const startedAt = Date.now();
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://fixture.local/px-harness",
      "X-Title": "PX Harness"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => null);
  const message = payload?.choices?.[0]?.message || null;
  const content = stripJsonMarkdown(extractContent(message));
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `OpenRouter request failed with ${response.status}`);
  }
  if (!content) throw new Error("OpenRouter returned no plan content.");

  return {
    plan: normalizePlan(JSON.parse(content), prompt, pageContext, selections),
    rawContent: content,
    usage: payload?.usage || null,
    durationMs
  };
}

function buildMessages({ prompt, pageContext, pageDom, selections }) {
  return [
    {
      role: "system",
      content: [
        "You generate safe declarative website transform plans for a browser extension.",
        "Return only valid JSON.",
        "Never include JavaScript, event handlers, external URLs, network requests, or arbitrary executable code.",
        "Use the page DOM summary and user-selected elements as grounding.",
        "User selections mark what the user pointed at, but clicks often land on inner decorative nodes such as touch feedback, overlays, icons, or empty wrappers.",
        "When the user says modify this element, they usually mean the visible control or label, often the parent or grandparent of the clicked node.",
        "Each selection includes hierarchyCandidates and semanticTarget. Walk up the hierarchy when needed and prefer the ancestor that contains the visible text, label, or interactive control.",
        "Do not target empty decorative layers when the prompt is about text color, labels, buttons, chips, tabs, links, or visible content.",
        "For text styling, target the element that actually owns the visible text, or a parent wrapper whose children include that text.",
        "Prefer specific scoped selectors from hierarchyCandidates or selectorHints over broad shared classes that match many unrelated elements.",
        "User selections mark what the user pointed at. Infer broader targets when the prompt implies a class of elements, such as all video titles.",
        "Build targetMap entries with CSS selectors that match the intended elements on this page.",
        "Each targetMap entry must include selectors and may include fallbackSelectors.",
        "If a target comes from a user selection, set source to selection and include selectionRef.",
        "If a target is inferred from page patterns, set source to inferred.",
        "Rules must reference targetRef values defined in targetMap.",
        "Never put raw selectors on rules. Selectors belong in targetMap only.",
        "If the user asks for one specific change, return only the minimal rules needed.",
        "Prefer type style with a styles object for color, size, spacing, borders, backgrounds, and other standard CSS properties.",
        "Use type css only when a raw CSS declaration block is truly necessary. css rules must include a css string field.",
        "Do not use type css for simple property changes such as color red or font-size 16px.",
        "Use only allowed style properties.",
        "Never use local filesystem paths in CSS."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Create a transform plan for the user's prompt.",
        prompt,
        pageContext,
        pageDom,
        selections,
        availableAssets: [],
        allowedRuleTypes: ["css", "style", "visibility", "attribute"],
        allowedStyleKeys: ALLOWED_STYLE_KEYS,
        schemaExample: TRANSFORM_SCHEMA_HINT
      })
    }
  ];
}

function normalizePlan(payload, prompt, pageContext, selections) {
  return {
    ...payload,
    version: payload.version || "2.0",
    sourcePrompt: payload.sourcePrompt || prompt,
    site: payload.site || {
      hostname: pageContext.hostname,
      pathname: pageContext.pathname,
      urlPattern: `${pageContext.hostname}${pageContext.pathname}*`
    },
    selections: payload.selections || selections.map(({ id, tag, ariaLabel, text }) => ({
      id,
      tag,
      ariaLabel,
      text: text?.slice(0, 120)
    })),
    targetMap: payload.targetMap || {},
    rules: Array.isArray(payload.rules) ? payload.rules.map(normalizeRule) : []
  };
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== "object") return rule;
  const normalized = { ...rule };
  const styles = normalized.styles || normalized.style;
  if (styles && typeof styles === "object" && !Array.isArray(styles)) {
    normalized.styles = styles;
    delete normalized.style;
    if (normalized.type === "css" || !normalized.type) {
      normalized.type = "style";
      delete normalized.css;
    }
  }
  if (normalized.type === "css" && normalized.css && typeof normalized.css === "object") {
    normalized.type = "style";
    normalized.styles = normalized.css;
    delete normalized.css;
  }
  return normalized;
}

function loadOpenRouterKey() {
  const envJsPath = "/home/cochon/Documents/Perso-XXL/config/env.js";
  const envPath = "/home/cochon/Documents/Perso-XXL/.env";

  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;

  if (existsSync(envJsPath)) {
    const envJs = readFileSync(envJsPath, "utf8");
    const match = envJs.match(/OPENROUTER_API_KEY:\s*["']([^"']+)["']/);
    if (match?.[1]) return match[1];
  }

  if (existsSync(envPath)) {
    const envText = readFileSync(envPath, "utf8");
    const match = envText.match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
  }

  throw new Error("Missing OpenRouter key. Set OPENROUTER_API_KEY or configure Perso-XXL/config/env.js.");
}

function extractContent(message) {
  if (!message) return null;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  return null;
}

function stripJsonMarkdown(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

