import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import tasks from "../evals/tasks.json" with { type: "json" };
import { getPage } from "./fixtures.mjs";
import { gradeBrowserTask } from "./browser-grader.mjs";
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

const routesByPageId = {
  dashboard: "/dashboard",
  "docs-home": "/docs",
  "youtube-feed": "/youtube"
};

const server = await startWebZooServer();
const userDataDir = join(tmpdir(), `px-harness-chrome-${Date.now()}`);
mkdirSync(userDataDir, { recursive: true });

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
  const run = await runBrowserSuite(context, server.origin, { extensionAvailable });
  const result = finalize(run);
  writeFileSync("reports/browser-baseline.json", JSON.stringify(result, null, 2));
  writeReports(result, "reports/browser-baseline");
  console.log(`[browser-baseline] low reasoning average: ${formatScore(result.summary.lowThinkingScore)}`);
  console.log("[browser-baseline] wrote reports/browser-baseline.html and reports/browser-baseline.json");
} finally {
  await context?.close().catch(() => {});
  await server.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
}

async function runBrowserSuite(browserContext, origin, { extensionAvailable }) {
  const page = await browserContext.newPage();
  const cdp = await browserContext.newCDPSession(page);
  const contextIds = new Set();
  cdp.on("Runtime.executionContextCreated", (event) => {
    contextIds.add(event.context.id);
  });
  await cdp.send("Runtime.enable");

  const taskResults = [];
  for (const task of tasks) {
    const fixturePage = getPage(task.pageId);
    const url = `${origin}${routesByPageId[task.pageId]}`;
    const startedAt = Date.now();
    const consoleMessages = [];
    page.on("console", (message) => {
      consoleMessages.push({ type: message.type(), text: message.text() });
    });

    try {
      await page.goto(url, { waitUntil: "networkidle" });
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
      taskResults.push({
        taskId: task.id,
        tier: task.tier,
        score: grade.score,
        passed: grade.passed,
        durationMs: Date.now() - startedAt,
        grade,
        plan: generation.plan,
        validation: generation.validation,
        applyResult: generation.applyResult,
        selectionCount: generation.selectionCount,
        pageNodeCount: generation.pageNodeCount,
        executionMode: generation.executionMode,
        consoleMessages: consoleMessages.slice(-20)
      });
      console.log(`  browser-low ${task.id}: ${formatScore(grade.score)}`);
    } catch (error) {
      taskResults.push({
        taskId: task.id,
        tier: task.tier,
        score: 0,
        passed: false,
        durationMs: Date.now() - startedAt,
        error: error.message,
        consoleMessages: consoleMessages.slice(-20)
      });
      console.log(`  browser-low ${task.id}: ERROR ${error.message}`);
    }
  }

  await page.close();
  return {
    label: "browser-low-thinking-1",
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

function finalize(run) {
  const taskAverages = run.tasks.map((task) => ({
    id: task.taskId,
    tier: task.tier,
    noThinkingAverage: task.score,
    lowThinkingScore: task.score,
    observation: task.error || task.grade?.actual?.notes?.join(" ")
  }));

  return {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    config: {
      mode: "browser",
      reasoningMode: "low",
      executionMode: run.executionMode,
      taskCount: run.tasks.length,
      extensionPath: resolve(EXTENSION_PATH)
    },
    summary: {
      noThinkingRuns: 0,
      noThinkingAverage: 0,
      lowThinkingScore: run.averageScore
    },
    runs: [{
      label: run.label,
      reasoningMode: run.reasoningMode,
      averageScore: run.averageScore,
      passedTasks: run.passedTasks,
      totalTasks: run.totalTasks,
      averageDurationMs: run.averageDurationMs
    }],
    taskAverages,
    observations: buildObservations(run),
    raw: [run]
  };
}

function buildObservations(run) {
  const observations = [
    `Browser low-reasoning baseline scored ${formatScore(run.averageScore)} across ${run.totalTasks} tasks.`,
    run.executionMode === "extension-content-script"
      ? "This run exercises Perso XXL content scripts, DOM context extraction, validation, and executor in a real browser on fixture pages."
      : "Chrome did not load unpacked extensions in this environment, so this run injects Perso DOM/executor scripts into Chrome pages and uses the Node planner. It tests real browser DOM execution, but not extension loading."
  ];
  const weakest = [...run.tasks].sort((left, right) => left.score - right.score).slice(0, 2);
  for (const task of weakest) {
    observations.push(`${task.taskId} scored ${formatScore(task.score)}. ${task.error || task.grade?.actual?.notes?.join(" ") || "Inspect trace details."}`);
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

function formatScore(score) {
  return `${Math.round(score * 100)}%`;
}
