import { readFileSync } from "node:fs";
import { buildCaseContext } from "./context.mjs";
import { generateTransformPlan } from "./plan-client.mjs";
import { gradePlan } from "./grader.mjs";
import { writeReports } from "./report.mjs";

const MODEL = "deepseek/deepseek-v4-flash";
const tasks = JSON.parse(readFileSync("evals/tasks.json", "utf8"));
const args = parseArgs(process.argv.slice(2));

const noThinkingRuns = Number(args["runs-no-thinking"] || 10);
const runLowThinking = args["run-low-thinking"] !== "false";

const result = {
  generatedAt: new Date().toISOString(),
  model: MODEL,
  config: {
    noThinkingRuns,
    runLowThinking,
    taskCount: tasks.length
  },
  runs: [],
  taskAverages: [],
  observations: [],
  raw: []
};

for (let runIndex = 0; runIndex < noThinkingRuns; runIndex += 1) {
  const run = await runSuite({
    label: `no-thinking-${runIndex + 1}`,
    reasoningMode: "none"
  });
  result.runs.push(summarizeRun(run));
  result.raw.push(run);
  writeReports(finalizeResult(result), "reports/baseline.partial");
  console.log(`[baseline] ${run.label}: ${formatScore(run.averageScore)}`);
}

if (runLowThinking) {
  const run = await runSuite({
    label: "low-thinking-1",
    reasoningMode: "low"
  });
  result.runs.push(summarizeRun(run));
  result.raw.push(run);
  console.log(`[baseline] ${run.label}: ${formatScore(run.averageScore)}`);
}

writeReports(finalizeResult(result), "reports/baseline");
console.log("[baseline] wrote reports/baseline.html and reports/baseline.json");

async function runSuite({ label, reasoningMode }) {
  const taskResults = [];

  for (const task of tasks) {
    const context = buildCaseContext(task);
    const startedAt = Date.now();
    try {
      const generation = await generateTransformPlan({
        prompt: task.prompt,
        pageContext: context.pageContext,
        pageDom: context.pageDom,
        selections: context.selections,
        reasoningMode,
        model: MODEL
      });
      const grade = gradePlan({ task, page: context.page, plan: generation.plan });
      taskResults.push({
        taskId: task.id,
        tier: task.tier,
        score: grade.score,
        passed: grade.passed,
        durationMs: generation.durationMs,
        usage: generation.usage,
        grade,
        plan: generation.plan
      });
      console.log(`  ${label} ${task.id}: ${formatScore(grade.score)}`);
    } catch (error) {
      taskResults.push({
        taskId: task.id,
        tier: task.tier,
        score: 0,
        passed: false,
        durationMs: Date.now() - startedAt,
        error: error.message
      });
      console.log(`  ${label} ${task.id}: ERROR ${error.message}`);
    }
  }

  const averageScore = average(taskResults.map((task) => task.score));
  return {
    label,
    reasoningMode,
    averageScore,
    passedTasks: taskResults.filter((task) => task.passed).length,
    totalTasks: taskResults.length,
    averageDurationMs: average(taskResults.map((task) => task.durationMs)),
    tasks: taskResults
  };
}

function finalizeResult(current) {
  const noThinking = current.raw.filter((run) => run.reasoningMode === "none");
  const lowThinking = current.raw.find((run) => run.reasoningMode === "low") || null;

  const taskAverages = tasks.map((task) => {
    const noThinkingScores = noThinking
      .map((run) => run.tasks.find((item) => item.taskId === task.id)?.score)
      .filter((score) => typeof score === "number");
    const lowThinkingTask = lowThinking?.tasks.find((item) => item.taskId === task.id);
    const noThinkingAverage = average(noThinkingScores);
    const lowThinkingScore = typeof lowThinkingTask?.score === "number" ? lowThinkingTask.score : null;
    return {
      id: task.id,
      tier: task.tier,
      noThinkingAverage,
      lowThinkingScore,
      observation: observeTask(task.id, noThinkingAverage, lowThinkingScore)
    };
  });

  const summary = {
    noThinkingRuns: noThinking.length,
    noThinkingAverage: average(noThinking.map((run) => run.averageScore)),
    lowThinkingScore: lowThinking?.averageScore ?? null
  };

  return {
    ...current,
    summary,
    taskAverages,
    observations: buildObservations({ summary, taskAverages, runs: current.raw })
  };
}

function buildObservations({ summary, taskAverages, runs }) {
  if (!runs.length) return ["No completed runs yet."];
  const observations = [];
  observations.push(`The no-thinking baseline currently averages ${formatScore(summary.noThinkingAverage)} over ${summary.noThinkingRuns} run(s).`);
  if (summary.lowThinkingScore !== null) {
    const delta = summary.lowThinkingScore - summary.noThinkingAverage;
    observations.push(`The single low-thinking run scored ${formatScore(summary.lowThinkingScore)}, a ${delta >= 0 ? "+" : ""}${formatScore(delta)} delta from the no-thinking average.`);
  }

  const weakest = [...taskAverages].sort((left, right) => left.noThinkingAverage - right.noThinkingAverage).slice(0, 2);
  for (const task of weakest) {
    observations.push(`${task.id} is one of the weakest tasks at ${formatScore(task.noThinkingAverage)}. ${task.observation}`);
  }

  const failures = runs.flatMap((run) => run.tasks.filter((task) => task.error).map((task) => task.error));
  if (failures.length) {
    observations.push(`There were ${failures.length} task-level runtime errors. The first was: ${failures[0]}`);
  }

  observations.push("V1 measures plan quality and selector grounding on structured fixtures. It does not yet load the real extension in Chromium, so browser-side mutation/reapply failures remain unmeasured.");
  return observations;
}

function observeTask(taskId, noThinkingAverage, lowThinkingScore) {
  if (noThinkingAverage >= 0.8) return "Current planner usually handles this task.";
  if (taskId.includes("scroll")) return "This likely needs a trusted behavior capability, not just declarative style rules.";
  if (taskId.includes("theme")) return "This is intentionally subjective; the text-only grader only checks broad deterministic signals.";
  if (taskId.includes("gallery")) return "Failures usually mean the planner did not infer the right unselected region or used unsupported selectors.";
  if (taskId.includes("creator")) return "Failures usually mean typo resolution or card-level targeting is weak.";
  if (lowThinkingScore !== null && lowThinkingScore > noThinkingAverage) return "Low thinking did better on the sampled run, but one run is not enough to conclude.";
  return "Inspect generated selectors and matched targets before changing prompts.";
}

function summarizeRun(run) {
  return {
    label: run.label,
    reasoningMode: run.reasoningMode,
    averageScore: run.averageScore,
    passedTasks: run.passedTasks,
    totalTasks: run.totalTasks,
    averageDurationMs: run.averageDurationMs
  };
}

function average(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function formatScore(score) {
  return `${Math.round(score * 100)}%`;
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

