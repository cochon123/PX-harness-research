import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import tasks from "../evals/tasks.json" with { type: "json" };
import { getPage } from "./fixtures.mjs";
import { gradeBrowserActual, gradeBrowserTask } from "./browser-grader.mjs";
import { generateTransformPlan } from "./plan-client.mjs";
import { writeReports } from "./report.mjs";
import { startWebZooServer } from "./web-zoo-server.mjs";

const EXTENSION_PATH = "/home/cochon/Documents/Perso-XXL";
const BROWSER_CANDIDATES = [
  process.env.PX_HARNESS_BROWSER,
  "/snap/bin/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome"
].filter(Boolean);
const MODEL = "deepseek/deepseek-v4-flash";
const BROWSER_PATH = findBrowserPath();
const args = parseArgs(process.argv.slice(2));
const RUN_COUNT = Number(args.runs || 1);
const SCREENSHOT_DIR = "reports/browser-screenshots";
const SKIP_PASS_RATE = args["skip-pass-rate"] ? Number(args["skip-pass-rate"]) : null;
const SKIP_SOURCE = args["skip-source"] || "reports/browser-baseline.json";
const TASK_FILTER = parseListArg(args.tasks);
const TAG_FILTER = parseListArg(args.tags);

const routesByPageId = {
  dashboard: "/dashboard",
  "docs-home": "/docs",
  "youtube-feed": "/youtube"
};

const server = await startWebZooServer();
const userDataDir = join(tmpdir(), `px-harness-chrome-${Date.now()}`);
const selectedTasks = filterTasks(tasks, { taskIds: TASK_FILTER, tags: TAG_FILTER });
const skipPlan = buildSkipPlan(selectedTasks, { threshold: SKIP_PASS_RATE, sourcePath: SKIP_SOURCE });
const runnableTasks = selectedTasks.filter((task) => !skipPlan.ids.has(task.id));
mkdirSync(userDataDir, { recursive: true });
if (!args["keep-screenshots"]) rmSync(SCREENSHOT_DIR, { recursive: true, force: true });
mkdirSync(SCREENSHOT_DIR, { recursive: true });
if (skipPlan.skipped.length) {
  console.log(`[browser-baseline] skipping ${skipPlan.skipped.length} task(s) at pass-rate >= ${formatScore(SKIP_PASS_RATE)} from ${SKIP_SOURCE}`);
}
if (selectedTasks.length !== tasks.length) {
  console.log(`[browser-baseline] selected ${selectedTasks.length}/${tasks.length} task(s)`);
}

let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: BROWSER_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  const extensionAvailable = await detectExtensionSupport(context);
  const runs = [];
  for (let runIndex = 0; runIndex < RUN_COUNT; runIndex += 1) {
    const run = await runBrowserSuite(context, server.origin, { extensionAvailable, runIndex, runnableTasks });
    runs.push(run);
    const partial = finalize(runs, skipPlan);
    writeFileSync("reports/browser-baseline.json", JSON.stringify(partial, null, 2));
    writeReports(partial, "reports/browser-baseline");
    console.log(`[browser-baseline] ${run.label}: ${formatScore(run.averageScore)}`);
  }
  const result = finalize(runs, skipPlan);
  writeFileSync("reports/browser-baseline.json", JSON.stringify(result, null, 2));
  writeReports(result, "reports/browser-baseline");
  console.log(`[browser-baseline] low reasoning average: ${formatScore(result.summary.lowThinkingScore)}`);
  console.log("[browser-baseline] wrote reports/browser-baseline.html and reports/browser-baseline.json");
} finally {
  await context?.close().catch(() => {});
  await server.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
}

async function runBrowserSuite(browserContext, origin, { extensionAvailable, runIndex, runnableTasks }) {
  const page = await browserContext.newPage();
  const cdp = await browserContext.newCDPSession(page);
  const contextIds = new Set();
  cdp.on("Runtime.executionContextCreated", (event) => {
    contextIds.add(event.context.id);
  });
  await cdp.send("Runtime.enable");

  const taskResults = [];
  for (const task of runnableTasks) {
    const fixturePage = getPage(task.pageId);
    const url = `${origin}${routesByPageId[task.pageId]}`;
    const startedAt = Date.now();
    const consoleMessages = [];
    let beforeScreenshotPath = null;
    const fallbackSemanticCandidates = buildSemanticCandidates(task, fixturePage, { plan: {} }, { planGrade: { targetMatches: {} } });
    page.on("console", (message) => {
      consoleMessages.push({ type: message.type(), text: message.text() });
    });

    try {
      await page.goto(url, { waitUntil: "networkidle" });
      beforeScreenshotPath = `${SCREENSHOT_DIR}/run-${runIndex + 1}-${task.id}-before.png`;
      await page.screenshot({ path: beforeScreenshotPath, fullPage: true });
      const generation = extensionAvailable
        ? await runWithExtensionContext(cdp, contextIds, task)
        : await runWithInjectedPersoScripts(page, task);
      await page.waitForTimeout(350);
      const grade = await gradeBrowserTask({
        page,
        task,
        fixturePage,
        plan: generation.plan
      });
      await triggerRerenderAndReapply({ page, cdp, contextIds, extensionAvailable, plan: generation.plan });
      await page.waitForTimeout(350);
      const persistence = await gradeBrowserActual({ page, task, plan: generation.plan });
      const combinedScore = roundScore((grade.score * 0.75) + (persistence.score * 0.25));
      const screenshotPath = `${SCREENSHOT_DIR}/run-${runIndex + 1}-${task.id}-after.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const diagnostics = buildTaskDiagnostics({ task, fixturePage, generation, grade, persistence });
      taskResults.push({
        taskId: task.id,
        tier: task.tier,
        score: combinedScore,
        passed: combinedScore >= 0.8,
        durationMs: Date.now() - startedAt,
        grade,
        persistence,
        diagnostics,
        plan: generation.plan,
        validation: generation.validation,
        applyResult: generation.applyResult,
        selectionCount: generation.selectionCount,
        pageNodeCount: generation.pageNodeCount,
        executionMode: generation.executionMode,
        beforeScreenshotPath,
        screenshotPath,
        consoleMessages: filterConsoleMessages(consoleMessages).slice(-20)
      });
      console.log(`  browser-low ${task.id}: ${formatScore(combinedScore)}`);
    } catch (error) {
      taskResults.push({
        taskId: task.id,
        tier: task.tier,
        score: 0,
        passed: false,
        durationMs: Date.now() - startedAt,
        error: error.message,
        diagnostics: {
          phase: "generation-or-validation",
          semanticCandidates: fallbackSemanticCandidates,
          failureReasons: [error.message]
        },
        beforeScreenshotPath,
        consoleMessages: filterConsoleMessages(consoleMessages).slice(-20)
      });
      console.log(`  browser-low ${task.id}: ERROR ${error.message}`);
    }
  }

  await page.close();
  return {
    label: `browser-low-thinking-${runIndex + 1}`,
    reasoningMode: "low",
    executionMode: extensionAvailable ? "extension-content-script" : "injected-perso-scripts",
    averageScore: average(taskResults.map((task) => task.score)),
    passedTasks: taskResults.filter((task) => task.passed).length,
    totalTasks: taskResults.length,
    averageDurationMs: average(taskResults.map((task) => task.durationMs)),
    tasks: taskResults
  };
}

async function detectExtensionSupport(browserContext) {
  const page = await browserContext.newPage();
  try {
    await page.goto("chrome://extensions-internals");
    await page.waitForTimeout(500);
    const text = await page.locator("body").innerText().catch(() => "");
    return text.includes("Perso XXL");
  } finally {
    await page.close().catch(() => {});
  }
}

async function runWithExtensionContext(cdp, contextIds, task) {
  const contentContextId = await findPersoContext(cdp, contextIds);
  return runPersoInContentContext(cdp, contentContextId, task);
}

async function triggerRerenderAndReapply({ page, cdp, contextIds, extensionAvailable, plan }) {
  await page.evaluate(() => {
    window.__PX_WEB_ZOO_RERENDER__?.();
  });

  if (extensionAvailable) {
    const contentContextId = await findPersoContext(cdp, contextIds);
    await cdp.send("Runtime.evaluate", {
      contextId: contentContextId,
      expression: `window.PersoExecutor.applyPlan(${JSON.stringify(plan)})`,
      awaitPromise: true,
      returnByValue: true,
      timeout: 30000
    });
    return;
  }

  await page.evaluate((planToApply) => {
    window.PersoExecutor.applyPlan(planToApply);
  }, plan);
}

async function findPersoContext(cdp, contextIds) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const contextId of contextIds) {
      const result = await cdp.send("Runtime.evaluate", {
        contextId,
        expression: "Boolean(window.PersoAiClient && window.PersoDomContext && window.PersoExecutor)",
        returnByValue: true
      }).catch(() => null);
      if (result?.result?.value === true) return contextId;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for Perso content-script context.");
}

async function runPersoInContentContext(cdp, contextId, task) {
  const expression = `(${contentTaskRunner.toString()})(${JSON.stringify({
    prompt: task.prompt,
    selectionUid: task.selectionUid || null,
    model: MODEL
  })})`;

  const result = await cdp.send("Runtime.evaluate", {
    contextId,
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 120000
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Perso content task failed.");
  }

  return result.result.value;
}

async function runWithInjectedPersoScripts(page, task) {
  await injectPersoRuntime(page);
  const browserContext = await page.evaluate((selectionUid) => {
    const selected = selectionUid ? document.querySelector(`[data-uid="${CSS.escape(selectionUid)}"]`) : null;
    const selections = selected ? [window.PersoDomContext.buildSelection(selected, "sel_1")] : [];
    const pageContext = {
      url: location.href,
      hostname: location.hostname,
      pathname: location.pathname,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
    const pageDom = window.PersoDomContext.collectPageDom({ maxNodes: 500 });
    return {
      selections,
      pageContext,
      pageDom,
      selectionCount: selections.length,
      pageNodeCount: pageDom.nodeCount
    };
  }, task.selectionUid || null);

  const generation = await generateTransformPlan({
    prompt: task.prompt,
    pageContext: browserContext.pageContext,
    pageDom: browserContext.pageDom,
    selections: browserContext.selections,
    reasoningMode: "low",
    model: MODEL
  });

  const applyResult = await page.evaluate((plan) => {
    window.PersoExecutor.revertPlan?.();
    return window.PersoExecutor.applyPlan(plan);
  }, generation.plan);

  return {
    plan: generation.plan,
    validation: { ok: true, errors: [] },
    applyResult,
    selectionCount: browserContext.selectionCount,
    pageNodeCount: browserContext.pageNodeCount,
    executionMode: "injected-perso-scripts"
  };
}

async function injectPersoRuntime(page) {
  await page.addScriptTag({
    content: `window.PersoLogger = {
      debug() {},
      info() {},
      warn() {},
      error() {}
    };`
  });
  await page.addScriptTag({ path: `${EXTENSION_PATH}/content/dom-context.js` });
  await page.addScriptTag({ path: `${EXTENSION_PATH}/content/executor.js` });
}

async function contentTaskRunner({ prompt, selectionUid, model }) {
  window.PersoEnv = {
    ...(window.PersoEnv || {}),
    OPENROUTER_MODEL: model,
    OPENROUTER_REASONING_ENABLED: true,
    OPENROUTER_REASONING_EFFORT: "low",
    OPENROUTER_REASONING_EXCLUDE: true
  };

  window.PersoExecutor.revertPlan?.();

  const selected = selectionUid ? document.querySelector(`[data-uid="${CSS.escape(selectionUid)}"]`) : null;
  const selections = selected ? [window.PersoDomContext.buildSelection(selected, "sel_1")] : [];
  const pageContext = {
    url: location.href,
    hostname: location.hostname,
    pathname: location.pathname,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  };
  const pageDom = window.PersoDomContext.collectPageDom({ maxNodes: 500 });

  let plan = await window.PersoAiClient.generateTransformPlan({
    prompt,
    pageContext,
    pageDom,
    selections,
    availableAssets: []
  });

  let validation = window.PersoAiClient.validateTransformPlan(plan);
  if (!validation.ok) {
    plan = await window.PersoAiClient.generateTransformPlan({
      prompt,
      pageContext,
      pageDom,
      selections,
      availableAssets: [],
      previousPlan: plan,
      validationErrors: validation.errors
    });
    validation = window.PersoAiClient.validateTransformPlan(plan);
  }

  if (!validation.ok) {
    throw new Error(`Generated plan failed validation: ${validation.errors.join(" ")}`);
  }

  const applyResult = window.PersoExecutor.applyPlan(plan);
  return {
    plan,
    validation,
    applyResult,
    selectionCount: selections.length,
    pageNodeCount: pageDom.nodeCount
  };
}

function finalize(runs, skipPlan = { skipped: [] }) {
  const taskAverages = selectedTasks.map((task) => {
    const skipped = skipPlan.skipped.find((item) => item.id === task.id);
    if (skipped) {
      return {
        id: task.id,
        tier: task.tier,
        what: task.what || "",
        tags: task.tags || [],
        skipped: true,
        skipReason: skipped.reason,
        previousPassRate: skipped.previousPassRate,
        noThinkingAverage: null,
        lowThinkingScore: null,
        minScore: null,
        maxScore: null,
        variance: 0,
        passRate: skipped.previousPassRate,
        runCount: 0,
        commonFailureReasons: [],
        observation: skipped.reason
      };
    }
    const taskRuns = runs
      .map((run) => run.tasks.find((item) => item.taskId === task.id))
      .filter(Boolean);
    const scores = taskRuns.map((item) => item.score);
    const failed = taskRuns.filter((item) => !item.passed || item.error);
    return {
      id: task.id,
      tier: task.tier,
      what: task.what || "",
      tags: task.tags || [],
      skipped: false,
      noThinkingAverage: null,
      lowThinkingScore: average(scores),
      minScore: scores.length ? Math.min(...scores) : 0,
      maxScore: scores.length ? Math.max(...scores) : 0,
      variance: variance(scores),
      passRate: taskRuns.length ? failed.length === 0 ? 1 : (taskRuns.length - failed.length) / taskRuns.length : 0,
      runCount: taskRuns.length,
      commonFailureReasons: commonFailureReasons(taskRuns),
      observation: summarizeTaskObservation(taskRuns)
    };
  });

  const runScores = runs.map((run) => run.averageScore);

  return {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    config: {
      mode: "browser",
      reasoningMode: "low",
      executionMode: runs[0]?.executionMode || "unknown",
      runCount: runs.length,
      taskCount: selectedTasks.length,
      allTaskCount: tasks.length,
      executedTaskCount: selectedTasks.length - skipPlan.skipped.length,
      skippedTaskCount: skipPlan.skipped.length,
      skippedTasks: skipPlan.skipped,
      skipPassRate: SKIP_PASS_RATE,
      skipSource: SKIP_SOURCE,
      taskFilter: TASK_FILTER,
      tagFilter: TAG_FILTER,
      extensionPath: resolve(EXTENSION_PATH)
    },
    summary: {
      noThinkingRuns: 0,
      noThinkingAverage: 0,
      lowThinkingScore: average(runScores),
      minScore: Math.min(...runScores),
      maxScore: Math.max(...runScores),
      variance: variance(runScores)
    },
    runs: runs.map((run) => ({
      label: run.label,
      reasoningMode: run.reasoningMode,
      averageScore: run.averageScore,
      passedTasks: run.passedTasks,
      totalTasks: run.totalTasks,
      averageDurationMs: run.averageDurationMs
    })),
    taskAverages,
    observations: buildObservations(runs, taskAverages),
    raw: runs
  };
}

function filterTasks(allTasks, { taskIds, tags }) {
  return allTasks.filter((task) => {
    const taskMatch = !taskIds.length || taskIds.includes(task.id);
    const tagMatch = !tags.length || (task.tags || []).some((tag) => tags.includes(tag));
    return taskMatch && tagMatch;
  });
}

function buildSkipPlan(allTasks, { threshold, sourcePath }) {
  if (!Number.isFinite(threshold)) return { ids: new Set(), skipped: [] };
  if (!existsSync(sourcePath)) {
    console.log(`[browser-baseline] skip source not found: ${sourcePath}; running all tasks`);
    return { ids: new Set(), skipped: [] };
  }

  const previous = JSON.parse(readFileSync(sourcePath, "utf8"));
  const previousById = new Map((previous.taskAverages || []).map((task) => [task.id, task]));
  const skipped = allTasks
    .map((task) => {
      const previousTask = previousById.get(task.id);
      const previousPassRate = Number(previousTask?.passRate);
      if (!Number.isFinite(previousPassRate) || previousPassRate < threshold) return null;
      return {
        id: task.id,
        tier: task.tier,
        what: task.what || "",
        previousPassRate,
        threshold,
        reason: `Previous pass rate ${formatScore(previousPassRate)} is at or above skip threshold ${formatScore(threshold)}.`
      };
    })
    .filter(Boolean);
  return {
    ids: new Set(skipped.map((task) => task.id)),
    skipped
  };
}

function buildTaskDiagnostics({ task, fixturePage, generation, grade, persistence }) {
  const targetMatches = grade.planGrade?.targetMatches || {};
  const broadSelectors = Object.entries(targetMatches)
    .flatMap(([targetRef, match]) => (match.selectors || []).map((selector) => ({
      targetRef,
      selector,
      matchCount: match.uids?.length || 0,
      matchedUids: match.uids || [],
      sampleText: match.sampleText || []
    })))
    .filter((item) => item.matchCount > 1);

  const forbiddenChanged = Array.from(new Set([
    ...(grade.actual?.details?.changedForbiddenUids || []),
    ...(persistence?.details?.changedForbiddenUids || [])
  ]));

  const selectionHintStrings = (generation.plan?.selections || [])
    .flatMap((selection) => [
      ...(selection.selectorHints || []),
      ...(selection.semanticTarget?.selectorHints || [])
    ])
    .filter(Boolean);

  const selectors = Object.values(generation.plan?.targetMap || {})
    .flatMap((target) => [...(target.selectors || []), ...(target.fallbackSelectors || [])]);

  const usedSelectionHints = selectors.some((selector) => selectionHintStrings.some((hint) => selector.includes(hint) || hint.includes(selector)));
  const genericSelectors = selectors.filter((selector) => isGenericSelector(selector));

  return {
    targetMatches,
    broadSelectors,
    forbiddenChanged,
    semanticCandidates: buildSemanticCandidates(task, fixturePage, generation, grade),
    phase: classifyFailurePhase({ generation, grade, persistence, broadSelectors, forbiddenChanged }),
    usedSelectionHints,
    genericSelectors,
    failureReasons: [
      ...(grade.actual?.notes || []),
      ...(persistence?.notes || []).map((note) => `persistence: ${note}`),
      ...broadSelectors.map((item) => `selector ${item.selector} matched ${item.matchCount} nodes`),
      ...forbiddenChanged.map((uid) => `forbidden node changed: ${uid}`),
      ...(genericSelectors.length ? [`generic selectors: ${genericSelectors.join(", ")}`] : [])
    ],
    taskKind: task.expect.kind
  };
}

function buildSemanticCandidates(task, fixturePage, generation, grade) {
  if (!task.semanticProbe) return null;
  const expectedUids = new Set(task.expect?.targetUids || []);
  const targetMatches = grade.planGrade?.targetMatches || {};
  const matchedUids = new Set(Object.values(targetMatches).flatMap((match) => match.uids || []));
  const candidates = fixturePage.nodes
    .filter((node) => isSemanticCandidate(node, task.semanticProbe.candidateKind))
    .map((node) => {
      const haystack = [
        node.text,
        node.attrs?.["aria-label"],
        node.attrs?.["data-channel"],
        node.id,
        node.classes?.join(" ")
      ].filter(Boolean).join(" ");
      return {
        uid: node.uid,
        tag: node.tag,
        text: node.text || "",
        ariaLabel: node.attrs?.["aria-label"] || "",
        dataChannel: node.attrs?.["data-channel"] || "",
        scoreToQuery: similarity(task.semanticProbe.query, haystack),
        scoreToExpected: similarity(task.semanticProbe.expected, haystack),
        isExpected: expectedUids.has(node.uid),
        selectedByPlan: matchedUids.has(node.uid)
      };
    })
    .sort((left, right) => right.scoreToQuery - left.scoreToQuery)
    .slice(0, 8);

  const best = candidates[0] || null;
  const expected = candidates.find((candidate) => candidate.isExpected) || null;
  const expectedSelected = candidates.some((candidate) => candidate.isExpected && candidate.selectedByPlan);
  return {
    query: task.semanticProbe.query,
    expected: task.semanticProbe.expected,
    candidateKind: task.semanticProbe.candidateKind,
    expectedCandidateVisibleInContext: Boolean(expected),
    expectedCandidateSelectedByPlan: expectedSelected,
    bestCandidate: best,
    candidates
  };
}

function isSemanticCandidate(node, kind) {
  if (!node?.uid) return false;
  if (kind === "youtube-channel") return node.classes?.includes("channel-name") || Boolean(node.attrs?.["data-channel"]);
  if (kind === "youtube-title") return /title/i.test(node.id || "") || node.classes?.includes("yt-simple-endpoint");
  if (kind === "youtube-badge") return node.classes?.includes("sponsor-badge") || node.attrs?.["data-sponsored"] === "true";
  return Boolean(node.text || node.attrs?.["aria-label"]);
}

function classifyFailurePhase({ generation, grade, persistence, broadSelectors, forbiddenChanged }) {
  if (generation.validation && generation.validation.ok === false) return "plan-validation";
  if (grade.actual?.targetHit === false && !grade.planGrade?.passed) return "target-understanding-or-selector";
  if (broadSelectors.length || forbiddenChanged.length || grade.actual?.forbiddenHit || persistence?.forbiddenHit) return "selector-blast-radius";
  if (grade.actual?.targetHit && persistence?.targetHit === false) return "persistence";
  if (grade.actual?.targetHit === false) return "browser-application";
  return "ok-or-low-risk";
}

function buildObservations(runs, taskAverages) {
  const runScores = runs.map((run) => run.averageScore);
  const observations = [
    `Browser low-reasoning baseline averaged ${formatScore(average(runScores))} across ${runs.length} run(s).`,
    `Run score range: ${formatScore(Math.min(...runScores))} to ${formatScore(Math.max(...runScores))}; variance ${variance(runScores).toFixed(4)}.`,
    runs[0]?.executionMode === "extension-content-script"
      ? "This run exercises Perso XXL content scripts, DOM context extraction, validation, and executor in a real browser on fixture pages."
      : "Chrome did not load unpacked extensions in this environment, so this run injects Perso DOM/executor scripts into Chrome pages and uses the Node planner. It tests real browser DOM execution, but not extension loading."
  ];
  const weakest = taskAverages
    .filter((task) => !task.skipped)
    .sort((left, right) => left.lowThinkingScore - right.lowThinkingScore)
    .slice(0, 3);
  for (const task of weakest) {
    observations.push(`${task.id} averaged ${formatScore(task.lowThinkingScore)} with ${formatScore(task.passRate)} pass rate. ${task.commonFailureReasons.join(" ") || task.observation}`);
  }
  return observations;
}

function findBrowserPath() {
  const found = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`No supported browser found. Tried: ${BROWSER_CANDIDATES.join(", ")}`);
  }
  return found;
}

function average(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function variance(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (nums.length <= 1) return 0;
  const avg = average(nums);
  return nums.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / nums.length;
}

function commonFailureReasons(taskRuns) {
  const counts = new Map();
  for (const taskRun of taskRuns) {
    const reasons = taskRun.error
      ? [taskRun.error]
      : taskRun.diagnostics?.failureReasons || [];
    for (const reason of reasons) {
      if (!reason || /browser target has expected|browser target is hidden|browser forbidden nodes avoided|remain visible|scroll appears locked|first video remains visible|has visual CSS/.test(reason)) continue;
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([reason, count]) => `${reason} (${count}x)`);
}

function summarizeTaskObservation(taskRuns) {
  const latest = taskRuns[taskRuns.length - 1];
  if (!latest) return "No runs.";
  if (latest.error) return latest.error;
  return [
    latest.grade?.actual?.notes?.join(" "),
    `Persistence: ${latest.persistence?.notes?.join(" ") || "not checked"}`,
    latest.diagnostics?.forbiddenChanged?.length ? `Forbidden changed: ${latest.diagnostics.forbiddenChanged.join(", ")}` : "",
    latest.diagnostics?.broadSelectors?.length ? `Broad selectors: ${latest.diagnostics.broadSelectors.map((item) => `${item.selector} -> ${item.matchCount}`).join("; ")}` : ""
  ].filter(Boolean).join(" ");
}

function isGenericSelector(selector) {
  return /^\.?[a-z0-9_-]+$/i.test(selector) ||
    /^[a-z]+(\.[a-z0-9_-]+)?$/i.test(selector) ||
    selector.split(/\s+|>/).some((part) => /^\.?(metric-title-text|video-card|channel-name|ytd-rich-item-renderer)$/i.test(part.replace(/[.#]/g, "")));
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value = "true"] = arg.slice(2).split("=");
    parsed[key] = value;
  }
  return parsed;
}

function parseListArg(value) {
  if (!value || value === "true") return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function similarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (b.includes(a) || a.includes(b)) return 1;
  const distance = levenshtein(a, b);
  return roundScore(1 - (distance / Math.max(a.length, b.length)));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function filterConsoleMessages(messages) {
  return messages.filter((message) => {
    if (message.type !== "error") return true;
    return !/localhost:8787|net::ERR_CONNECTION_REFUSED/.test(message.text);
  });
}

function formatScore(score) {
  return `${Math.round(score * 100)}%`;
}
