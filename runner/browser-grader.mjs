import { gradePlan } from "./grader.mjs";

export async function gradeBrowserTask({ page, task, fixturePage, plan }) {
  const planGrade = gradePlan({ task, page: fixturePage, plan });
  const actual = await gradeBrowserActual({ page, task, plan });
  const score = roundScore((planGrade.score * 0.45) + (actual.score * 0.55));

  return {
    score,
    passed: score >= 0.8,
    planGrade,
    actual
  };
}

export async function gradeBrowserActual({ page, task, plan }) {
  const expect = task.expect;

  if (expect.kind === "style") {
    const targetValues = await getComputedValues(page, expect.targetUids || [], expect.property);
    const forbiddenValues = await getComputedValues(page, expect.forbiddenUids || [], expect.property);
    const targetHit = targetValues.some((item) => valueMatches(item.value, expect.valueIncludes));
    const forbiddenHit = forbiddenValues.some((item) => valueMatches(item.value, expect.valueIncludes));
    const changedForbiddenUids = forbiddenValues
      .filter((item) => valueMatches(item.value, expect.valueIncludes))
      .map((item) => item.uid);
    return scoreParts({
      targetHit,
      forbiddenHit,
      operationHit: targetHit,
      detailHit: targetHit,
      notes: [
        targetHit ? "browser target has expected style" : "browser target does not have expected style",
        forbiddenHit ? "browser forbidden node was also changed" : "browser forbidden nodes avoided"
      ],
      details: { targetValues, forbiddenValues, changedForbiddenUids }
    });
  }

  if (expect.kind === "visibility") {
    const targetVisibility = await getVisibility(page, expect.targetUids || []);
    const forbiddenVisibility = await getVisibility(page, expect.forbiddenUids || []);
    const targetHit = targetVisibility.some((item) => item.hidden);
    const forbiddenHit = forbiddenVisibility.some((item) => item.hidden);
    const changedForbiddenUids = forbiddenVisibility
      .filter((item) => item.hidden)
      .map((item) => item.uid);
    return scoreParts({
      targetHit,
      forbiddenHit,
      operationHit: targetHit,
      detailHit: targetHit,
      notes: [
        targetHit ? "browser target is hidden" : "browser target is still visible",
        forbiddenHit ? "browser forbidden node was hidden" : "browser forbidden nodes remain visible"
      ],
      details: { targetVisibility, forbiddenVisibility, changedForbiddenUids }
    });
  }

  if (expect.kind === "scrollLock") {
    const result = await page.evaluate(async () => {
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const first = document.querySelector('[data-uid="video-first-card"]');
      const firstStyle = first ? getComputedStyle(first) : null;
      return {
        scrollY: window.scrollY,
        bodyOverflow: getComputedStyle(document.body).overflow,
        htmlOverflow: getComputedStyle(document.documentElement).overflow,
        firstVisible: first ? firstStyle.display !== "none" && firstStyle.visibility !== "hidden" : false
      };
    });
    const locked = result.scrollY < 20 || result.bodyOverflow === "hidden" || result.htmlOverflow === "hidden";
    return {
      score: roundScore((locked ? 0.65 : 0) + (result.firstVisible ? 0.35 : 0)),
      notes: [
        locked ? "browser scroll appears locked" : "browser can still scroll",
        result.firstVisible ? "first video remains visible" : "first video is not visible"
      ],
      targetHit: locked,
      forbiddenHit: !result.firstVisible,
      details: result
    };
  }

  if (expect.kind === "theme") {
    const result = await page.evaluate(() => {
      const styled = Array.from(document.querySelectorAll("[data-perso-xxl-rule]"));
      const styleText = Array.from(document.querySelectorAll("style"))
        .map((style) => style.textContent || "")
        .join("\n")
        .toLowerCase();
      return {
        styledCount: styled.length,
        styleTextSample: styleText.slice(0, 1000),
        hasVisualCss: /background|color|font|shadow|border/.test(styleText)
      };
    });
    const serialized = JSON.stringify(plan).toLowerCase();
    const keywordHits = (expect.keywords || []).filter((keyword) => serialized.includes(keyword));
    return {
      score: roundScore((result.hasVisualCss ? 0.45 : 0) + (result.styledCount >= 2 ? 0.25 : 0) + Math.min(keywordHits.length, 3) * 0.1),
      notes: [
        result.hasVisualCss ? "browser has visual CSS changes" : "browser has no clear visual CSS changes",
        `${result.styledCount} nodes marked as changed`,
        keywordHits.length ? `theme keywords: ${keywordHits.join(", ")}` : "no explicit theme keywords"
      ],
      targetHit: result.hasVisualCss,
      forbiddenHit: false,
      details: result
    };
  }

  return { score: 0, notes: [`Unknown expectation kind ${expect.kind}`], targetHit: false, forbiddenHit: false };
}

async function getComputedValues(page, uids, property) {
  return page.evaluate(({ uids, property }) => {
    return uids.map((uid) => {
      const node = document.querySelector(`[data-uid="${CSS.escape(uid)}"]`);
      return {
        uid,
        exists: Boolean(node),
        value: node ? getComputedStyle(node)[property] || "" : ""
      };
    });
  }, { uids, property });
}

async function getVisibility(page, uids) {
  return page.evaluate((uids) => {
    return uids.map((uid) => {
      const node = document.querySelector(`[data-uid="${CSS.escape(uid)}"]`);
      if (!node) return { uid, exists: false, hidden: true };
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        uid,
        exists: true,
        hidden: style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || rect.width === 0 || rect.height === 0
      };
    });
  }, uids);
}

function valueMatches(value, expectedValues = []) {
  const normalized = String(value || "").toLowerCase();
  return expectedValues.some((expected) => normalized.includes(String(expected).toLowerCase()));
}

function scoreParts({ targetHit, forbiddenHit, operationHit, detailHit, notes, details }) {
  return {
    score: roundScore((targetHit ? 0.4 : 0) + (operationHit ? 0.25 : 0) + (detailHit ? 0.25 : 0) + (!forbiddenHit ? 0.1 : 0)),
    notes,
    targetHit,
    forbiddenHit,
    details
  };
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
