import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeReports(result, outputBase = "reports/baseline") {
  mkdirSync(dirname(`${outputBase}.json`), { recursive: true });
  writeFileSync(`${outputBase}.json`, JSON.stringify(result, null, 2));
  writeFileSync(`${outputBase}.html`, renderHtml(result));
}

function renderHtml(result) {
  const isBrowser = result.config?.mode === "browser";
  const escaped = (value) => escapeHtml(String(value ?? ""));
  const runRows = result.runs.map((run) => `
    <tr>
      <td>${escaped(run.label)}</td>
      <td>${escaped(run.reasoningMode)}</td>
      <td>${percent(run.averageScore)}</td>
      <td>${escaped(run.passedTasks)}/${escaped(run.totalTasks)}</td>
      <td>${escaped(Math.round(run.averageDurationMs))} ms</td>
    </tr>
  `).join("");

  const taskRows = result.taskAverages.map((task) => `
    <tr>
      <td>${escaped(task.id)}</td>
      <td>${escaped(task.tier)}</td>
      <td>${isBrowser ? "n/a" : percent(task.noThinkingAverage)}</td>
      <td>${task.lowThinkingScore === null ? "n/a" : percent(task.lowThinkingScore)}</td>
      <td>${escaped(task.observation)}</td>
    </tr>
  `).join("");

  const observations = result.observations.map((item) => `<li>${escaped(item)}</li>`).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Perso XXL Baseline Observations</title>
    <style>
      :root { --bg: #f7f4ee; --ink: #211f1b; --muted: #615c52; --panel: #fff; --line: #d7cfc0; --accent: #0f766e; --bad: #991b1b; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); line-height: 1.55; }
      header { background: #183a37; color: white; padding: 38px 24px 30px; }
      .wrap { width: min(1120px, calc(100vw - 32px)); margin: 0 auto; }
      h1 { margin: 0; font-size: clamp(2rem, 4vw, 4rem); line-height: 1.05; letter-spacing: 0; }
      h2 { margin: 0 0 12px; font-size: 1.35rem; }
      p { margin: 10px 0 0; }
      main { padding: 26px 0 54px; }
      .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
      .card { grid-column: span 6; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; }
      .full { grid-column: 1 / -1; }
      .metric { font-size: 2.2rem; font-weight: 800; color: var(--accent); line-height: 1; }
      .muted { color: var(--muted); }
      table { width: 100%; border-collapse: collapse; font-size: 0.93rem; }
      th, td { border: 1px solid var(--line); padding: 10px; text-align: left; vertical-align: top; }
      th { background: #f0eadf; }
      code { background: #e8f0ef; padding: 0.1rem 0.28rem; border-radius: 4px; }
      ul { margin: 8px 0 0; padding-left: 20px; }
      li { margin: 7px 0; }
      .bar { height: 12px; border-radius: 999px; background: #e7e0d3; overflow: hidden; margin-top: 8px; }
      .bar span { display: block; height: 100%; width: ${Math.round(result.summary.noThinkingAverage * 100)}%; background: var(--accent); }
      @media (max-width: 840px) { .grid { display: block; } .card { margin: 14px 0; } }
    </style>
  </head>
  <body>
    <header>
      <div class="wrap">
        <h1>Perso XXL baseline observations</h1>
        <p>Generated ${escaped(result.generatedAt)} using ${escaped(result.model)} against the v1 PX harness.</p>
      </div>
    </header>
    <main class="wrap">
      <section class="grid">
        <article class="card">
          <h2>No-thinking average</h2>
          <div class="metric">${isBrowser ? "n/a" : percent(result.summary.noThinkingAverage)}</div>
          <div class="bar"><span></span></div>
          <p class="muted">${isBrowser ? `Browser execution mode: ${escaped(result.config?.executionMode)}` : `Average over ${escaped(result.summary.noThinkingRuns)} runs of the full v1 task set.`}</p>
        </article>
        <article class="card">
          <h2>Low-thinking run</h2>
          <div class="metric">${result.summary.lowThinkingScore === null ? "n/a" : percent(result.summary.lowThinkingScore)}</div>
          <p class="muted">Single run with OpenRouter reasoning set to low.</p>
        </article>
        <article class="card full">
          <h2>First Observations</h2>
          <ul>${observations}</ul>
        </article>
        <article class="card full">
          <h2>Run Summary</h2>
          <table>
            <thead><tr><th>Run</th><th>Reasoning</th><th>Score</th><th>Passed tasks</th><th>Avg duration</th></tr></thead>
            <tbody>${runRows}</tbody>
          </table>
        </article>
        <article class="card full">
          <h2>Task Averages</h2>
          <table>
            <thead><tr><th>Task</th><th>Tier</th><th>${isBrowser ? "No-thinking avg" : "No-thinking avg"}</th><th>Low-thinking</th><th>Observation</th></tr></thead>
            <tbody>${taskRows}</tbody>
          </table>
        </article>
      </section>
    </main>
  </body>
</html>`;
}

function percent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
