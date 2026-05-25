import { ALLOWED_STYLE_KEYS } from "./plan-client.mjs";
import { isValidSubsetSelector, querySelectorAllSubset } from "./selector-engine.mjs";

const ALLOWED_RULE_TYPES = new Set(["style", "visibility", "attribute", "css"]);
const ALLOWED_STYLE_KEY_SET = new Set(ALLOWED_STYLE_KEYS);

export function gradePlan({ task, page, plan }) {
  const validation = validatePlan(plan);
  const targetMatches = collectTargetMatches(plan, page);
  const expectation = gradeExpectation(task, plan, targetMatches);
  const score = roundScore((validation.ok ? 0.2 : 0) + expectation.score * 0.8);

  return {
    score,
    passed: score >= 0.8,
    validation,
    expectation,
    targetMatches
  };
}

function validatePlan(input) {
  const errors = [];
  const targetRefs = new Set(Object.keys(input?.targetMap || {}));

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["Plan must be a JSON object."] };
  }
  if (!input.site) errors.push("Plan must include site.");
  if (!input.targetMap || typeof input.targetMap !== "object") errors.push("Plan must include targetMap.");
  if (!Array.isArray(input.rules)) {
    errors.push("Plan must include rules array.");
  } else if (input.rules.length > 30) {
    errors.push("Plan cannot contain more than 30 rules.");
  } else {
    input.rules.forEach((rule, index) => validateRule(rule, index, errors, targetRefs));
  }

  Object.entries(input.targetMap || {}).forEach(([key, target]) => {
    if (!target || typeof target !== "object") {
      errors.push(`Target ${key} must be an object.`);
      return;
    }
    if (!Array.isArray(target.selectors) || target.selectors.length === 0) {
      errors.push(`Target ${key} must include selectors.`);
    }
    for (const selector of [...(target.selectors || []), ...(target.fallbackSelectors || [])]) {
      if (!isValidSubsetSelector(selector)) errors.push(`Target ${key} has unsupported or invalid selector ${selector}.`);
    }
  });

  return { ok: errors.length === 0, errors };
}

function validateRule(rule, index, errors, targetRefs) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    errors.push(`Rule ${index} must be an object.`);
    return;
  }
  if (!ALLOWED_RULE_TYPES.has(rule.type)) errors.push(`Rule ${index} has unsupported type.`);
  if (rule.selector) errors.push(`Rule ${index} uses a raw selector. Use targetRef instead.`);
  if (rule.type !== "css" && !rule.targetRef) errors.push(`Rule ${index} must include targetRef.`);
  if (rule.targetRef && !targetRefs.has(rule.targetRef)) errors.push(`Rule ${index} references unknown targetRef ${rule.targetRef}.`);

  if (rule.type === "style") {
    if (!rule.styles || typeof rule.styles !== "object" || Array.isArray(rule.styles)) {
      errors.push(`Rule ${index} style rule must include styles object.`);
    } else {
      for (const key of Object.keys(rule.styles)) {
        if (!ALLOWED_STYLE_KEY_SET.has(key)) errors.push(`Rule ${index} uses unsupported style key ${key}.`);
      }
    }
  }

  if (rule.type === "visibility" && !["hide", "show", "dim"].includes(rule.action)) {
    errors.push(`Rule ${index} has unsupported visibility action.`);
  }

  if (rule.type === "attribute" && typeof rule.attribute !== "string") {
    errors.push(`Rule ${index} attribute rule must include attribute name.`);
  }

  if (rule.type === "css") {
    if (typeof rule.css !== "string" || rule.css.length > 5000) {
      errors.push(`Rule ${index} css rules need rule.css as a string.`);
    } else if (/@import|url\s*\(|expression\s*\(|javascript:|position\s*:\s*fixed|z-index\s*:\s*9999/i.test(rule.css)) {
      errors.push(`Rule ${index} CSS contains a blocked pattern.`);
    }
  }
}

function collectTargetMatches(plan, page) {
  const targetMatches = {};
  for (const [targetRef, target] of Object.entries(plan?.targetMap || {})) {
    const primary = matchSelectors(page, target.selectors || []);
    const fallback = primary.length ? [] : matchSelectors(page, target.fallbackSelectors || []);
    const matched = primary.length ? primary : fallback;
    targetMatches[targetRef] = {
      selectors: primary.length ? target.selectors || [] : target.fallbackSelectors || [],
      usedFallback: !primary.length && fallback.length > 0,
      uids: matched.map((node) => node.uid),
      sampleText: matched.slice(0, 5).map((node) => node.text)
    };
  }
  return targetMatches;
}

function matchSelectors(page, selectors) {
  const nodes = new Set();
  for (const selector of selectors) {
    if (!isValidSubsetSelector(selector)) continue;
    try {
      for (const node of querySelectorAllSubset(page, selector)) nodes.add(node);
    } catch (_error) {
      continue;
    }
  }
  return Array.from(nodes);
}

function gradeExpectation(task, plan, targetMatches) {
  const expect = task.expect;
  const matchedByTargetRef = matchedUidsByRule(plan, targetMatches);
  const allMatchedUids = new Set(Object.values(matchedByTargetRef).flat());
  const targetHit = expect.targetUids?.some((uid) => allMatchedUids.has(uid)) || false;
  const forbiddenHit = expect.forbiddenUids?.some((uid) => allMatchedUids.has(uid)) || false;

  if (expect.kind === "style") {
    const matchingRules = (plan.rules || []).filter((rule) => rule.type === "style" && rule.styles?.[expect.property]);
    const valueHit = matchingRules.some((rule) => {
      const value = String(rule.styles[expect.property]).toLowerCase();
      return expect.valueIncludes.some((expected) => value.includes(String(expected).toLowerCase()));
    });
    return scoreParts({
      targetHit,
      forbiddenHit,
      operationHit: matchingRules.length > 0,
      detailHit: valueHit,
      notes: [
        targetHit ? "matched intended target" : "did not match intended target",
        valueHit ? `set ${expect.property} close to expected value` : `did not set expected ${expect.property}`
      ]
    });
  }

  if (expect.kind === "visibility") {
    const matchingRules = (plan.rules || []).filter((rule) => rule.type === "visibility" && rule.action === expect.action);
    const displayNoneRules = (plan.rules || []).filter((rule) => rule.type === "style" && String(rule.styles?.display || "").toLowerCase() === "none");
    const operationRules = [...matchingRules, ...displayNoneRules];
    return scoreParts({
      targetHit,
      forbiddenHit,
      operationHit: operationRules.length > 0,
      detailHit: operationRules.length > 0,
      notes: [
        targetHit ? "matched intended target" : "did not match intended target",
        operationRules.length ? `used a hide operation` : "did not use expected hide action"
      ]
    });
  }

  if (expect.kind === "scrollLock") {
    const cssText = (plan.rules || []).filter((rule) => rule.type === "css").map((rule) => rule.css).join("\n").toLowerCase();
    const styleRules = (plan.rules || []).filter((rule) => rule.type === "style");
    const hasOverflowHidden = /overflow\s*:\s*hidden/.test(cssText) ||
      styleRules.some((rule) => String(rule.styles?.overflow || "").toLowerCase().includes("hidden"));
    const firstVideoPreserved = !allMatchedUids.has("video-first-card");
    const broadEnough = cssText.includes("body") || cssText.includes("html") || allMatchedUids.has("youtube-root") || allMatchedUids.has("feed-root");
    return {
      score: roundScore((hasOverflowHidden ? 0.45 : 0) + (broadEnough ? 0.25 : 0) + (firstVideoPreserved ? 0.2 : 0) + (targetHit ? 0.1 : 0)),
      notes: [
        hasOverflowHidden ? "attempted overflow lock" : "no clear scroll lock",
        broadEnough ? "targets page/feed level" : "does not target page/feed level",
        firstVideoPreserved ? "does not hide the first video" : "may hide the first video"
      ],
      targetHit,
      forbiddenHit: !firstVideoPreserved
    };
  }

  if (expect.kind === "theme") {
    const rules = plan.rules || [];
    const serialized = JSON.stringify(plan).toLowerCase();
    const keywordHits = expect.keywords.filter((keyword) => serialized.includes(keyword));
    const hasSeveralRules = rules.length >= expect.minRuleCount;
    const hasVisualStyles = rules.some((rule) => rule.type === "style" && (
      rule.styles?.background || rule.styles?.backgroundColor || rule.styles?.color || rule.styles?.fontFamily || rule.styles?.boxShadow
    )) || rules.some((rule) => rule.type === "css" && /background|color|font|shadow/i.test(rule.css || ""));
    return {
      score: roundScore((hasSeveralRules ? 0.35 : 0) + (hasVisualStyles ? 0.35 : 0) + Math.min(keywordHits.length, 3) * 0.1),
      notes: [
        hasSeveralRules ? "has multiple rules" : "too few rules for a broad theme",
        hasVisualStyles ? "uses visual style changes" : "does not clearly style the page",
        keywordHits.length ? `theme keywords: ${keywordHits.join(", ")}` : "no explicit One Piece theme cues"
      ],
      targetHit: hasVisualStyles,
      forbiddenHit: false
    };
  }

  return { score: 0, notes: [`Unknown expectation kind ${expect.kind}`], targetHit: false, forbiddenHit: false };
}

function matchedUidsByRule(plan, targetMatches) {
  const out = {};
  for (const rule of plan.rules || []) {
    if (!rule.targetRef) continue;
    out[rule.id || rule.targetRef] = targetMatches[rule.targetRef]?.uids || [];
  }
  return out;
}

function scoreParts({ targetHit, forbiddenHit, operationHit, detailHit, notes }) {
  return {
    score: roundScore((targetHit ? 0.4 : 0) + (operationHit ? 0.25 : 0) + (detailHit ? 0.25 : 0) + (!forbiddenHit ? 0.1 : 0)),
    notes,
    targetHit,
    forbiddenHit
  };
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
