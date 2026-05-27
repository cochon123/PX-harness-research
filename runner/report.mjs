import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

export function writeReports(result, outputBase = "reports/baseline") {
  mkdirSync(dirname(`${outputBase}.json`), { recursive: true });
  writeFileSync(`${outputBase}.json`, JSON.stringify(result, null, 2));
  writeFileSync(`${outputBase}.html`, renderHtml(result, outputBase));
}

function renderHtml(result, outputBase) {
  const isBrowser = result.config?.mode === "browser";
  return isBrowser ? renderBrowserHtml(result, outputBase) : renderPlannerHtml(result);
}

function renderBrowserHtml(result, outputBase) {
  const escaped = (value) => escapeHtml(String(value ?? ""));
  const outputDir = dirname(`${outputBase}.html`);
  const runRows = result.runs.map((run) => `
    <tr>
      <td>${escaped(run.label)}</td>
      <td>${percent(run.averageScore)}</td>
      <td>${escaped(run.passedTasks)}/${escaped(run.totalTasks)}</td>
      <td>${escaped(Math.round(run.averageDurationMs))} ms</td>
    </tr>
  `).join("");

  const taskRows = result.taskAverages.map((task) => `
    <tr>
      <td>${escaped(task.id)}</td>
      <td>${escaped(task.tier)}</td>
      <td>${task.skipped ? "skipped" : percent(task.lowThinkingScore)}</td>
      <td>${task.skipped ? "n/a" : `${percent(task.minScore)} / ${percent(task.maxScore)}`}</td>
      <td>${task.variance.toFixed(4)}</td>
      <td>${percent(task.passRate)}</td>
      <td>${escaped(task.skipReason || task.commonFailureReasons.join(" | ") || "none")}</td>
    </tr>
  `).join("");

  const reviewRows = result.taskAverages.map((task) => renderReviewRow({ task, result, outputDir })).join("");
  const detailCards = result.taskAverages.map((task) => {
    if (task.skipped) return "";
    const runs = result.raw.map((run) => run.tasks.find((item) => item.taskId === task.id)).filter(Boolean);
    const selected = runs.find((item) => !item.passed || item.diagnostics?.forbiddenChanged?.length || item.diagnostics?.broadSelectors?.length) || runs[runs.length - 1];
    const semanticFallback = runs.find((item) => item.diagnostics?.semanticCandidates)?.diagnostics?.semanticCandidates;
    return renderTaskDetail({ task, runTask: selected, outputDir, semanticFallback });
  }).join("");

  const observations = result.observations.map((item) => `<li>${escaped(item)}</li>`).join("");
  const recommendations = (result.recommendations || []).map((item) => `<li>${escaped(item)}</li>`).join("");
  const domfsFacts = result.domfsFacts ? renderDomfsFacts(result.domfsFacts) : "";
  const domfsRecommendations = recommendations
    ? `<article class="card full"><h2>Where I Think We Should Go</h2><ul>${recommendations}</ul></article>`
    : "";

  return baseHtml({
    title: "Perso XXL Browser Baseline",
    body: `
      <header>
        <div class="wrap">
          <h1>Perso XXL browser baseline</h1>
          <p>Generated ${escaped(result.generatedAt)} using ${escaped(result.model)}. Execution mode: <code>${escaped(result.config?.executionMode)}</code>.</p>
        </div>
      </header>
      <main class="wrap">
        <section class="grid">
          <article class="card">
            <h2>Average</h2>
            <div class="metric">${percent(result.summary.lowThinkingScore)}</div>
            <p class="muted">${escaped(result.config?.runCount || result.runs.length)} low-reasoning browser run(s), ${escaped(result.config?.executedTaskCount ?? result.config?.taskCount)} executed task(s), ${escaped(result.config?.skippedTaskCount || 0)} skipped.</p>
          </article>
          <article class="card">
            <h2>Range</h2>
            <div class="metric">${percent(result.summary.minScore)} - ${percent(result.summary.maxScore)}</div>
            <p class="muted">Run-score variance: ${Number(result.summary.variance || 0).toFixed(4)}</p>
          </article>
          <article class="card full">
            <h2>Observations</h2>
            <ul>${observations}</ul>
          </article>
          ${domfsFacts}
          ${domfsRecommendations}
          <article class="card full">
            <h2>Human Review Table</h2>
            <table class="review-table">
              <thead><tr><th>Task</th><th>What we test</th><th>Initial screenshot</th><th>After modification</th><th>Status</th><th>If failed, why?</th><th>Log</th></tr></thead>
              <tbody>${reviewRows}</tbody>
            </table>
          </article>
          <article class="card full">
            <h2>Run Summary</h2>
            <table>
              <thead><tr><th>Run</th><th>Score</th><th>Passed</th><th>Avg duration</th></tr></thead>
              <tbody>${runRows}</tbody>
            </table>
          </article>
          <article class="card full">
            <h2>Task Stability</h2>
            <table>
              <thead><tr><th>Task</th><th>Tier</th><th>Avg</th><th>Min / Max</th><th>Variance</th><th>Pass rate</th><th>Common failure reasons</th></tr></thead>
              <tbody>${taskRows}</tbody>
            </table>
          </article>
          <article class="card full">
            <h2>Task Diagnostics</h2>
            <div class="details-grid">${detailCards}</div>
          </article>
        </section>
      </main>
    `
  });
}

function renderReviewRow({ task, result, outputDir }) {
  const escaped = (value) => escapeHtml(String(value ?? ""));
  const runs = result.raw.flatMap((run) => run.tasks.filter((item) => item.taskId === task.id));
  const selected = runs.find((item) => !item.passed || item.error) || runs.find((item) => item.diagnostics?.forbiddenChanged?.length || item.diagnostics?.broadSelectors?.length) || runs[runs.length - 1];
  const status = task.skipped
    ? `<span class="pill neutral">skipped</span>`
    : selected?.passed
      ? `<span class="pill pass">pass</span>`
      : `<span class="pill fail">fail</span>`;
  const reason = task.skipped ? task.skipReason : summarizeFailure(selected);
  const before = imageThumb(selected?.beforeScreenshotPath, outputDir, `Initial screenshot for ${task.id}`);
  const after = imageThumb(selected?.screenshotPath, outputDir, `After screenshot for ${task.id}`);
  const details = selected ? renderReviewDetails(selected) : escaped(task.skipReason || "No run details.");

  return `
    <tr>
      <td><strong>${escaped(task.id)}</strong><br><span class="muted">${escaped(task.tier)}${task.tags?.length ? ` | ${escaped(task.tags.join(", "))}` : ""}</span></td>
      <td>${escaped(task.what || "")}</td>
      <td>${before}</td>
      <td>${after}</td>
      <td>${status}</td>
      <td>${escaped(reason || "n/a")}</td>
      <td><details><summary>Open log</summary>${details}</details></td>
    </tr>
  `;
}

function imageThumb(path, outputDir, alt) {
  if (!path) return `<span class="muted">n/a</span>`;
  return `<img class="thumb" src="${escapeHtml(relative(outputDir, path))}" alt="${escapeHtml(alt)}">`;
}

function summarizeFailure(runTask) {
  if (!runTask) return "No run was executed.";
  if (runTask.error) return runTask.error;
  if (runTask.passed && !runTask.diagnostics?.forbiddenChanged?.length && !runTask.diagnostics?.broadSelectors?.length) return "";
  const reasons = [
    ...(runTask.diagnostics?.failureReasons || []),
    ...(runTask.grade?.actual?.notes || []),
    ...(runTask.persistence?.notes || []).map((note) => `persistence: ${note}`)
  ].filter((item) => item && !/browser target has expected|remain visible|scroll appears locked|first video remains visible|has visual CSS/.test(item));
  return Array.from(new Set(reasons)).slice(0, 4).join(" | ") || "Score below pass threshold.";
}

function renderReviewDetails(runTask) {
  const escaped = (value) => escapeHtml(String(value ?? ""));
  const consoleMessages = (runTask.consoleMessages || [])
    .map((message) => `${message.type}: ${message.text}`)
    .join("\n");
  const payload = {
    score: runTask.score,
    executionMode: runTask.executionMode,
    immediate: runTask.grade?.actual?.notes || [],
    persistence: runTask.persistence?.notes || [],
        diagnostics: runTask.diagnostics || {},
        domNavigation: runTask.domNavigation ? {
          version: runTask.domNavigation.version,
          queries: runTask.domNavigation.queries,
          selected: runTask.domNavigation.selected,
          searchResults: runTask.domNavigation.searchResults,
          inspections: runTask.domNavigation.inspections,
          toolTrace: runTask.domNavigation.toolTrace
        } : null,
        applyResult: runTask.applyResult || null,
    validation: runTask.validation || null,
    rules: runTask.plan?.rules || [],
    targetMap: runTask.plan?.targetMap || {},
    consoleMessages: consoleMessages || "none"
  };
  return `<pre><code>${escaped(JSON.stringify(payload, null, 2))}</code></pre>`;
}

function renderTaskDetail({ task, runTask, outputDir, semanticFallback = null }) {
  const escaped = (value) => escapeHtml(String(value ?? ""));
  if (!runTask) return "";

  const rules = JSON.stringify(runTask.plan?.rules || [], null, 2);
  const targetMap = runTask.plan?.targetMap || {};
  const matchRows = Object.entries(runTask.diagnostics?.targetMatches || {}).map(([targetRef, match]) => `
    <tr>
      <td>${escaped(targetRef)}</td>
      <td>${escaped((match.selectors || []).join(", "))}</td>
      <td>${escaped(match.uids?.length || 0)}</td>
      <td>${escaped((match.uids || []).join(", "))}</td>
    </tr>
  `).join("");
  const broad = runTask.diagnostics?.broadSelectors || [];
  const forbidden = runTask.diagnostics?.forbiddenChanged || [];
  const semantic = renderSemanticCandidates(runTask.diagnostics?.semanticCandidates || semanticFallback);
  const domNavigation = renderDomNavigation(runTask.diagnostics?.domNavigation);
  const screenshot = runTask.screenshotPath
    ? `<img class="shot" src="${escapeHtml(relative(outputDir, runTask.screenshotPath))}" alt="Screenshot for ${escaped(task.id)}">`
    : "";
  const consoleErrors = (runTask.consoleMessages || [])
    .filter((message) => message.type === "error")
    .map((message) => `<li>${escaped(message.text)}</li>`)
    .join("");

  return `
    <section class="detail">
      <h3>${escaped(task.id)} <span>${percent(runTask.score)}</span></h3>
      ${screenshot}
      <div class="mini-grid">
        <div>
          <h4>Immediate</h4>
          <p>${escaped(runTask.grade?.actual?.notes?.join(" ") || runTask.error || "n/a")}</p>
        </div>
        <div>
          <h4>Persistence</h4>
          <p>${escaped(runTask.persistence?.notes?.join(" ") || "n/a")}</p>
        </div>
        <div>
          <h4>Blast Radius</h4>
          <p>${forbidden.length ? `Forbidden changed: ${escaped(forbidden.join(", "))}` : "No forbidden nodes changed in selected run."}</p>
          <p>${broad.length ? `Broad selectors: ${escaped(broad.map((item) => `${item.selector} -> ${item.matchCount}`).join("; "))}` : "No broad selector diagnostic in selected run."}</p>
          <p>${runTask.diagnostics?.usedSelectionHints ? "Used selection hints." : "Did not clearly use selection hints."}</p>
          <p>Phase: ${escaped(runTask.diagnostics?.phase || "n/a")}</p>
        </div>
      </div>
      ${semantic}
      ${domNavigation}
      <h4>Selector Matches</h4>
      <table>
        <thead><tr><th>Target</th><th>Selectors</th><th>Count</th><th>Matched UIDs</th></tr></thead>
        <tbody>${matchRows || "<tr><td colspan=\"4\">No target matches recorded.</td></tr>"}</tbody>
      </table>
      <h4>Generated Rules</h4>
      <pre><code>${escaped(rules)}</code></pre>
      <h4>Target Map</h4>
      <pre><code>${escaped(JSON.stringify(targetMap, null, 2))}</code></pre>
      ${consoleErrors ? `<h4>Console Errors</h4><ul>${consoleErrors}</ul>` : ""}
    </section>
  `;
}

function renderDomfsFacts(facts) {
  const escaped = (value) => escapeHtml(String(value ?? ""));
  const limits = (facts.limits || []).map((item) => `<li>${escaped(item)}</li>`).join("");
  const comparison = facts.comparison ? `
    <p><strong>Comparison:</strong> ${escaped(facts.comparison.contextMode)} from <code>${escaped(facts.comparison.sourcePath)}</code> scored ${percent(facts.comparison.averageScore)} across ${escaped(facts.comparison.runCount)} run(s) and ${escaped(facts.comparison.executedTaskCount)} executed task(s).</p>
  ` : "";
  return `
    <article class="card full">
      <h2>DOMFS Experiment Facts</h2>
      <div class="fact-grid">
        <div><strong>${escaped(facts.executedTaskCount)}</strong><span>task runs</span></div>
        <div><strong>${escaped(facts.tasksWithDomfsContext)}</strong><span>with DOMFS context</span></div>
        <div><strong>${Number(facts.averageSearchResults || 0).toFixed(1)}</strong><span>avg find results</span></div>
        <div><strong>${Number(facts.averageInspections || 0).toFixed(1)}</strong><span>avg inspections</span></div>
        <div><strong>${escaped(facts.tasksUsingFixtureUidSelectors)}</strong><span>used fixture UID selectors</span></div>
        <div><strong>${escaped(facts.selectorBlastRadiusFailures)}</strong><span>blast-radius failures</span></div>
      </div>
      <p>Fixture-only selectors blocked: <strong>${facts.blockFixtureSelectors ? "yes" : "no"}</strong>.</p>
      <p>${escaped(facts.summary)}</p>
      ${comparison}
      <ul>${limits}</ul>
    </article>
  `;
}

function renderDomNavigation(domNavigation) {
  const escaped = (value) => escapeHtml(String(value ?? ""));
  if (!domNavigation) return "";
  const rows = (domNavigation.topFindings || []).flatMap((search) => (search.top || []).map((result) => `
    <tr>
      <td>${escaped(search.query)}</td>
      <td>${escaped(result.uid)}</td>
      <td>${escaped(result.path)}</td>
      <td>${escaped(result.text)}</td>
      <td>${percent(result.score)}</td>
      <td>${escaped((result.selectors || []).join(", "))}</td>
    </tr>
  `)).join("");
  return `
    <h4>DOMFS Navigation</h4>
    <p>Version: <code>${escaped(domNavigation.version)}</code>; selected path: <code>${escaped(domNavigation.selectedPath || "n/a")}</code>; queries: ${escaped(domNavigation.queryCount)}; inspections: ${escaped(domNavigation.inspectionCount)}.</p>
    <table>
      <thead><tr><th>Query</th><th>UID</th><th>Path</th><th>Text</th><th>Score</th><th>Proposed selectors</th></tr></thead>
      <tbody>${rows || "<tr><td colspan=\"6\">No DOMFS findings recorded.</td></tr>"}</tbody>
    </table>
  `;
}

function renderSemanticCandidates(semantic) {
  const escaped = (value) => escapeHtml(String(value ?? ""));
  if (!semantic) return "";
  const rows = (semantic.candidates || []).map((candidate) => `
    <tr>
      <td>${escaped(candidate.uid)}</td>
      <td>${escaped(candidate.text || candidate.ariaLabel || candidate.dataChannel)}</td>
      <td>${percent(candidate.scoreToQuery)}</td>
      <td>${candidate.isExpected ? "yes" : "no"}</td>
      <td>${candidate.selectedByPlan ? "yes" : "no"}</td>
    </tr>
  `).join("");
  return `
    <h4>Semantic Target Candidates</h4>
    <p>Query: <code>${escaped(semantic.query)}</code>; expected: <code>${escaped(semantic.expected)}</code>; expected visible in context: ${semantic.expectedCandidateVisibleInContext ? "yes" : "no"}; expected selected by plan: ${semantic.expectedCandidateSelectedByPlan ? "yes" : "no"}.</p>
    <table>
      <thead><tr><th>UID</th><th>Text / label</th><th>Fuzzy score</th><th>Expected</th><th>Selected by plan</th></tr></thead>
      <tbody>${rows || "<tr><td colspan=\"5\">No semantic candidates recorded.</td></tr>"}</tbody>
    </table>
  `;
}

function renderPlannerHtml(result) {
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
      <td>${percent(task.noThinkingAverage)}</td>
      <td>${task.lowThinkingScore === null ? "n/a" : percent(task.lowThinkingScore)}</td>
      <td>${escaped(task.observation)}</td>
    </tr>
  `).join("");

  const observations = result.observations.map((item) => `<li>${escaped(item)}</li>`).join("");

  return baseHtml({
    title: "Perso XXL Baseline Observations",
    body: `
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
            <div class="metric">${percent(result.summary.noThinkingAverage)}</div>
            <p class="muted">Average over ${escaped(result.summary.noThinkingRuns)} runs of the full v1 task set.</p>
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
              <thead><tr><th>Task</th><th>Tier</th><th>No-thinking avg</th><th>Low-thinking</th><th>Observation</th></tr></thead>
              <tbody>${taskRows}</tbody>
            </table>
          </article>
        </section>
      </main>
    `
  });
}

function baseHtml({ title, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      :root { --bg: #f7f4ee; --ink: #211f1b; --muted: #615c52; --panel: #fff; --line: #d7cfc0; --accent: #0f766e; --bad: #991b1b; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); line-height: 1.55; }
      header { background: #183a37; color: white; padding: 38px 24px 30px; }
      .wrap { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; }
      h1 { margin: 0; font-size: clamp(2rem, 4vw, 4rem); line-height: 1.05; letter-spacing: 0; }
      h2 { margin: 0 0 12px; font-size: 1.35rem; }
      h3 { display: flex; justify-content: space-between; gap: 16px; margin: 0 0 10px; font-size: 1rem; }
      h4 { margin: 16px 0 8px; font-size: 0.88rem; text-transform: uppercase; color: var(--muted); }
      p { margin: 10px 0 0; }
      main { padding: 26px 0 54px; }
      .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
      .card { grid-column: span 6; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px; }
      .full { grid-column: 1 / -1; }
      .metric { font-size: 2.2rem; font-weight: 800; color: var(--accent); line-height: 1; }
      .muted { color: var(--muted); }
      table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
      th, td { border: 1px solid var(--line); padding: 9px; text-align: left; vertical-align: top; }
      th { background: #f0eadf; }
      code { background: #e8f0ef; padding: 0.1rem 0.28rem; border-radius: 4px; }
      pre { overflow-x: auto; background: #102726; color: #eef7f4; border-radius: 8px; padding: 12px; font-size: 0.8rem; }
      pre code { background: transparent; color: inherit; padding: 0; }
      ul { margin: 8px 0 0; padding-left: 20px; }
      li { margin: 7px 0; }
      .details-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .detail { border: 1px solid var(--line); border-radius: 8px; padding: 14px; background: #fbfaf7; }
      .mini-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .mini-grid > div { border: 1px solid var(--line); border-radius: 8px; background: white; padding: 10px; }
      .fact-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin: 10px 0 12px; }
      .fact-grid > div { border: 1px solid var(--line); border-radius: 8px; background: white; padding: 12px; }
      .fact-grid strong { display: block; font-size: 1.5rem; color: var(--accent); line-height: 1; }
      .fact-grid span { display: block; margin-top: 6px; color: var(--muted); font-size: 0.82rem; }
      .shot { display: block; width: 100%; max-height: 220px; object-fit: cover; object-position: top; border: 1px solid var(--line); border-radius: 8px; margin: 8px 0 12px; }
      .thumb { display: block; width: 180px; max-width: 22vw; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
      .review-table td { min-width: 120px; }
      .review-table td:nth-child(2) { min-width: 220px; }
      details summary { cursor: pointer; color: var(--accent); font-weight: 700; }
      .pill { display: inline-block; border-radius: 999px; padding: 2px 9px; font-size: 0.78rem; font-weight: 800; text-transform: uppercase; }
      .pill.pass { background: #dcfce7; color: #166534; }
      .pill.fail { background: #fee2e2; color: #991b1b; }
      .pill.neutral { background: #e5e7eb; color: #374151; }
      @media (max-width: 900px) { .grid, .details-grid, .mini-grid, .fact-grid { display: block; } .card, .detail, .mini-grid > div, .fact-grid > div { margin: 14px 0; } }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function percent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  return `${Math.round((value || 0) * 100)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
