import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MODELS = [
  ["Mimo v2.5 pro", "xiaomi/mimo-v2.5-pro"],
  ["DeepSeek v4 pro", "deepseek/deepseek-v4-pro"],
  ["DeepSeek v4 flash", "deepseek/deepseek-v4-flash"],
  ["MiniMax m2.7", "minimax/minimax-m2.7"],
  ["MiniMax M3", "minimax/minimax-m3"],
  ["Gemma 4 27b", "google/gemma-4-26b-a4b-it"],
  ["Gemma 4 31b", "google/gemma-4-31b-it"],
  ["Qwen 3.6 plus", "qwen/qwen3.6-plus"],
  ["Grok 4.3", "x-ai/grok-4.3"],
  ["Qwen3.5 9b", "qwen/qwen3.5-9b"]
];

const MODEL_PRICES = {
  "xiaomi/mimo-v2.5-pro": { input: 0.435, output: 0.87 },
  "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87 },
  "deepseek/deepseek-v4-flash": { input: 0.0983, output: 0.1966 },
  "minimax/minimax-m2.7": { input: 0.279, output: 1.2 },
  "minimax/minimax-m3": { input: 0.3, output: 1.2 },
  "google/gemma-4-26b-a4b-it": { input: 0.06, output: 0.33 },
  "google/gemma-4-31b-it": { input: 0.12, output: 0.37 },
  "qwen/qwen3.6-plus": { input: 0.325, output: 1.95 },
  "x-ai/grok-4.3": { input: 1.25, output: 2.5 },
  "qwen/qwen3.5-9b": { input: 0.04, output: 0.15 }
};

const outputPath = process.argv.find((arg) => arg.startsWith("--output="))?.split("=")[1] || "reports/model-cost-analysis.html";
const runDir = process.argv.find((arg) => arg.startsWith("--run-dir="))?.split("=")[1] || "reports/model-runs";

const rows = MODELS.map(([label, id]) => {
  const reportPath = `${runDir}/${slug(id)}.json`;
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null;
  const tasks = report?.raw?.flatMap((run) => run.tasks || []) || [];
  const blockedReason = classifyBlockedReason(tasks);
  const usage = sumUsage(tasks);
  const price = MODEL_PRICES[id];
  const measuredCost = price ? ((usage.promptTokens / 1e6) * price.input) + ((usage.completionTokens / 1e6) * price.output) : null;
  return {
    label,
    id,
    reportPath,
    ran: Boolean(report && tasks.length && !blockedReason),
    blockedReason,
    score: blockedReason ? null : report?.summary?.lowThinkingScore ?? null,
    averageDurationMs: average(tasks.map((task) => task.durationMs)),
    passed: tasks.filter((task) => task.passed).length,
    total: tasks.length,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    measuredCost: blockedReason ? null : measuredCost,
    price
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, renderHtml(rows));
writeFileSync(outputPath.replace(/\.html$/, ".json"), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
console.log(`[model-comparison-report] wrote ${outputPath}`);

function sumUsage(tasks) {
  return tasks.reduce((sum, task) => {
    const usage = task.usage || {};
    const prompt = usage.prompt_tokens ?? usage.promptTokens ?? 0;
    const completion = usage.completion_tokens ?? usage.completionTokens ?? 0;
    const total = usage.total_tokens ?? usage.totalTokens ?? prompt + completion;
    sum.promptTokens += prompt;
    sum.completionTokens += completion;
    sum.totalTokens += total;
    return sum;
  }, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
}

function renderHtml(rows) {
  const ranRows = rows.filter((row) => row.ran);
  const best = [...ranRows].sort((a, b) => utility(b) - utility(a))[0] || null;
  const maxCost = Math.max(0.01, ...rows.map((row) => row.measuredCost || 0));
  const maxLatency = Math.max(1, ...rows.map((row) => row.averageDurationMs || 0));
  const cloudRows = rows.filter((row) => row.ran && (row.score === 1 || row.id === "minimax/minimax-m2.7"));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PX Actual Model Comparison</title>
  <style>
    :root{--ink:#172019;--muted:#66736c;--line:#dce3dd;--paper:#f7f8f3;--panel:#fff;--green:#17633f;--blue:#2f6f9e;--amber:#bd7a20;--red:#a94336}
    *{box-sizing:border-box} body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--paper);color:var(--ink);line-height:1.45}
    header{background:#1f3829;color:#fff;padding:36px 0 28px}.wrap{width:min(1180px,calc(100% - 28px));margin:0 auto}
    h1{margin:0;font-size:clamp(34px,6vw,68px);line-height:.98;letter-spacing:0} h2{margin:0 0 12px;font-size:22px} p{margin:10px 0 0;color:var(--muted)} header p{color:rgba(255,255,255,.78);max-width:760px}
    main{padding:18px 0 44px;display:grid;grid-template-columns:repeat(12,1fr);gap:16px} section{grid-column:span 12;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;box-shadow:0 18px 42px rgba(32,48,36,.08)}
    .half{grid-column:span 6}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.kpi{border:1px solid var(--line);border-radius:8px;padding:13px;background:#fbfcf8}.kpi strong{display:block;font-size:28px;margin-top:10px}.muted,.kpi span{color:var(--muted);font-size:13px}
    .bar{height:18px;border-radius:999px;background:#eef2ec;overflow:hidden}.bar i{display:block;height:100%;background:var(--green);border-radius:999px}.blue i{background:var(--blue)}.amber i{background:var(--amber)}.red i{background:var(--red)}
    .cloudWrap{display:grid;grid-template-columns:1fr 280px;gap:18px;align-items:start}.cloudStage{height:500px;border:1px solid var(--line);border-radius:8px;background:#fbfcf8;position:relative;overflow:hidden;touch-action:none}canvas{display:block;width:100%;height:100%;cursor:grab}.cloudStage.dragging canvas{cursor:grabbing}.legend{display:grid;gap:8px}.legendItem{display:grid;grid-template-columns:14px 1fr auto;gap:8px;align-items:center;font-size:13px}.dot{width:12px;height:12px;border-radius:50%}.axisNote{margin-top:8px;font-size:13px;color:var(--muted)}.toolRow{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.toolRow button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 10px;color:var(--ink);font-weight:700;cursor:pointer}.tooltip{position:absolute;pointer-events:none;background:#172019;color:white;border-radius:8px;padding:9px 10px;font-size:12px;box-shadow:0 12px 28px rgba(23,32,25,.22);transform:translate(12px,-50%);max-width:220px;display:none}.tooltip strong{display:block;font-size:13px;margin-bottom:3px}.tooltip span{display:block;color:rgba(255,255,255,.78)}
    table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}th{color:var(--muted);font-size:12px;text-transform:uppercase}.pill{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:12px;font-weight:800;background:#e7f1e8;color:var(--green)}.missing{background:#f4e2dd;color:var(--red)}
    @media(max-width:820px){main{display:block}section{margin-bottom:14px;overflow-x:auto}.half{grid-column:span 12}.kpis{grid-template-columns:1fr}.cloudWrap{grid-template-columns:1fr}.cloudStage{height:430px}table{min-width:880px}}
  </style>
</head>
<body>
  <header><div class="wrap"><h1>Actual PX model comparison</h1><p>Accuracy, latency, token usage, and measured API cost from the existing PX browser task harness. This page intentionally omits screenshots, logs, and per-task diagnostics.</p></div></header>
  <main class="wrap">
    <section><h2>Summary</h2><div class="kpis">
      <div class="kpi"><span>Models completed</span><strong>${ranRows.length}/${rows.length}</strong></div>
      <div class="kpi"><span>Best utility</span><strong>${best ? escapeHtml(best.label) : "n/a"}</strong></div>
      <div class="kpi"><span>Best score</span><strong>${formatPercent(Math.max(0, ...ranRows.map((row) => row.score || 0)))}</strong></div>
      <div class="kpi"><span>Total measured spend</span><strong>${formatMoney(ranRows.reduce((sum, row) => sum + (row.measuredCost || 0), 0))}</strong></div>
    </div></section>
    <section class="half"><h2>Accuracy Score</h2>${bars(rows, (row) => row.score ?? 0, 1, "blue", formatPercent)}</section>
    <section class="half"><h2>Measured Cost</h2>${bars(rows, (row) => row.measuredCost ?? 0, maxCost, "amber", formatMoney)}</section>
    <section class="half"><h2>Latency</h2>${bars(rows, (row) => row.averageDurationMs ?? 0, maxLatency, "green", (v) => `${(v / 1000).toFixed(1)}s`)}</section>
    <section class="half"><h2>Token Spend</h2>${bars(rows, (row) => row.totalTokens ?? 0, Math.max(1, ...rows.map((row) => row.totalTokens || 0)), "red", (v) => Math.round(v).toLocaleString())}</section>
    <section><h2>3D Cloud: High-Accuracy Model Tradeoffs</h2><div class="cloudWrap"><div class="cloudStage" id="cloudStage"><canvas id="cloud3d"></canvas><div class="tooltip" id="cloudTip"></div></div><div><p class="muted">Models shown: every model that scored 100%, plus MiniMax M2.7 because it was close. Position uses actual measured latency, measured cost, and completion tokens from this run.</p><div class="toolRow"><button type="button" id="resetCloud">Reset view</button><button type="button" id="topCloud">Top view</button></div><div class="legend" id="cloudLegend"></div><p class="axisNote">Drag to rotate, scroll or pinch to zoom, hover/tap points for exact values. X = latency, Y = measured cost, Z = output tokens.</p></div></div></section>
    <section><h2>Results Table</h2><table><thead><tr><th>Model</th><th>Status</th><th>Score</th><th>Passed</th><th>Latency</th><th>Prompt tokens</th><th>Completion tokens</th><th>Cost</th><th>OpenRouter price</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td><strong>${escapeHtml(row.label)}</strong><br><span class="muted">${escapeHtml(row.id)}</span></td><td><span class="pill ${row.ran ? "" : "missing"}">${row.ran ? "measured" : row.blockedReason ? "blocked" : "not run"}</span>${row.blockedReason ? `<br><span class="muted">${escapeHtml(row.blockedReason)}</span>` : ""}</td><td>${row.score === null ? "n/a" : formatPercent(row.score)}</td><td>${row.ran ? `${row.passed}/${row.total}` : "n/a"}</td><td>${row.ran && row.averageDurationMs ? `${(row.averageDurationMs / 1000).toFixed(1)}s` : "n/a"}</td><td>${row.ran ? row.promptTokens.toLocaleString() : "n/a"}</td><td>${row.ran ? row.completionTokens.toLocaleString() : "n/a"}</td><td>${row.measuredCost === null ? "n/a" : formatMoney(row.measuredCost)}</td><td>$${row.price.input}/$${row.price.output} per 1M</td></tr>`).join("")}
    </tbody></table></section>
  </main>
  <script>
    const cloudRows = ${JSON.stringify(cloudRows.map((row) => ({
      label: row.label,
      score: row.score,
      latencySeconds: Number(((row.averageDurationMs || 0) / 1000).toFixed(2)),
      cost: Number((row.measuredCost || 0).toFixed(6)),
      outputTokens: row.completionTokens
    })))};
    const palette = ["#17633f", "#2f6f9e", "#bd7a20", "#7357a6", "#ba4d39", "#4f8f73", "#5c789f", "#8a6f33"];
    const stage = document.getElementById("cloudStage");
    const canvas = document.getElementById("cloud3d");
    const tip = document.getElementById("cloudTip");
    const legend = document.getElementById("cloudLegend");
    const state = { yaw: -0.72, pitch: 0.52, zoom: 1, dragging: false, lastX: 0, lastY: 0, points: [] };
    cloudRows.forEach((row, index) => {
      legend.insertAdjacentHTML("beforeend", '<div class="legendItem"><span class="dot" style="background:' + palette[index % palette.length] + '"></span><span>' + escapeHtml(row.label) + '</span><strong>' + row.latencySeconds.toFixed(1) + 's</strong></div>');
    });
    document.getElementById("resetCloud").addEventListener("click", () => {
      state.yaw = -0.72; state.pitch = 0.52; state.zoom = 1; drawCloud();
    });
    document.getElementById("topCloud").addEventListener("click", () => {
      state.yaw = -0.78; state.pitch = 1.18; state.zoom = 1.05; drawCloud();
    });
    canvas.addEventListener("pointerdown", (event) => {
      state.dragging = true; state.lastX = event.clientX; state.lastY = event.clientY; stage.classList.add("dragging"); canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (state.dragging) {
        const dx = event.clientX - state.lastX;
        const dy = event.clientY - state.lastY;
        state.yaw += dx * 0.01;
        state.pitch = Math.max(-1.15, Math.min(1.25, state.pitch + dy * 0.008));
        state.lastX = event.clientX; state.lastY = event.clientY;
        drawCloud();
      }
      showNearest(event);
    });
    canvas.addEventListener("pointerup", (event) => {
      state.dragging = false; stage.classList.remove("dragging"); canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointerleave", () => {
      state.dragging = false; stage.classList.remove("dragging"); tip.style.display = "none";
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      state.zoom = Math.max(.72, Math.min(1.85, state.zoom * (event.deltaY > 0 ? .92 : 1.08)));
      drawCloud();
    }, { passive: false });
    function drawCloud() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;
      const pad = Math.min(76, w * .14);
      const cx = w / 2;
      const cy = h / 2 + 18;
      const minMax = (key) => {
        const values = cloudRows.map((row) => row[key]);
        return { min: Math.min(...values), max: Math.max(...values) };
      };
      const latency = minMax("latencySeconds");
      const cost = minMax("cost");
      const output = minMax("outputTokens");
      const norm = (value, range) => range.max === range.min ? .5 : (value - range.min) / (range.max - range.min);
      const rotateProject = (x, y, z) => {
        const scale = Math.min(w, h) * .62 * state.zoom;
        const px = (x - .5) * scale;
        const py = (.5 - y) * scale;
        const pz = (z - .5) * scale;
        const cosy = Math.cos(state.yaw), siny = Math.sin(state.yaw);
        const cosp = Math.cos(state.pitch), sinp = Math.sin(state.pitch);
        const rx = px * cosy - pz * siny;
        const rz = px * siny + pz * cosy;
        const ry = py * cosp - rz * sinp;
        const depth = py * sinp + rz * cosp;
        const perspective = 1 + depth / (scale * 3.5);
        return { x: cx + rx * perspective, y: cy + ry * perspective, depth, perspective };
      };
      const projectRow = (row) => {
        const x = norm(row.latencySeconds, latency);
        const y = norm(row.cost, cost);
        const z = norm(row.outputTokens, output);
        const p = rotateProject(x, y, z);
        return { ...p, size: 10 + p.perspective * 5, nx: x, ny: y, nz: z };
      };
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#fbfcf8"; ctx.fillRect(0,0,w,h);
      const gridColor = "#d4ded7";
      const axisColor = "#718079";
      const axis = [
        { a:[0,0,0], b:[1,0,0], label:"Latency", range: latency, format:(v)=>v.toFixed(0)+"s" },
        { a:[0,0,0], b:[0,1,0], label:"Cost", range: cost, format:(v)=>"$"+v.toFixed(3) },
        { a:[0,0,0], b:[0,0,1], label:"Output tokens", range: output, format:(v)=>Math.round(v/1000)+"k" }
      ];
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        drawLine(ctx, rotateProject(t,0,0), rotateProject(t,1,0), gridColor);
        drawLine(ctx, rotateProject(0,t,0), rotateProject(1,t,0), gridColor);
        drawLine(ctx, rotateProject(0,0,t), rotateProject(1,0,t), "#e3e9e4");
        drawLine(ctx, rotateProject(0,0,t), rotateProject(0,1,t), "#e3e9e4");
      }
      axis.forEach((item) => {
        const a = rotateProject(...item.a), b = rotateProject(...item.b);
        drawLine(ctx, a, b, axisColor, 2);
        ctx.fillStyle = "#172019"; ctx.font = "700 13px Inter, system-ui";
        ctx.fillText(item.label, b.x + 8, b.y - 4);
        for (let i = 0; i <= 4; i++) {
          const t = i / 4;
          const tick = [
            item.a[0] + (item.b[0] - item.a[0]) * t,
            item.a[1] + (item.b[1] - item.a[1]) * t,
            item.a[2] + (item.b[2] - item.a[2]) * t
          ];
          const p = rotateProject(...tick);
          const value = item.range.min + (item.range.max - item.range.min) * t;
          ctx.fillStyle = "#66736c"; ctx.font = "11px Inter, system-ui";
          ctx.fillText(item.format(value), p.x + 4, p.y + 13);
        }
      });
      const points = cloudRows.map((row, index) => ({ row, index, ...projectRow(row) })).sort((a, b) => a.depth - b.depth);
      state.points = points;
      points.forEach((point) => {
        const floor = rotateProject(point.nx, 0, point.nz);
        drawLine(ctx, floor, point, "rgba(23,32,25,.16)", 1);
        ctx.fillStyle = palette[point.index % palette.length];
        ctx.beginPath(); ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = "#172019"; ctx.font = "700 13px Inter, system-ui";
        const label = point.row.label.replace("DeepSeek ", "DS ").replace("MiniMax ", "MM ");
        ctx.fillText(label, point.x + point.size + 5, point.y - 4);
      });
    }
    function drawLine(ctx, a, b, color, width = 1) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    function showNearest(event) {
      if (!state.points.length) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let best = null;
      for (const point of state.points) {
        const d = Math.hypot(point.x - x, point.y - y);
        if (d <= point.size + 8 && (!best || d < best.d)) best = { point, d };
      }
      if (!best) { tip.style.display = "none"; return; }
      const row = best.point.row;
      tip.innerHTML = "<strong>" + escapeHtml(row.label) + "</strong><span>Score: " + Math.round(row.score * 100) + "%</span><span>Latency: " + row.latencySeconds.toFixed(1) + "s/task</span><span>Cost: $" + row.cost.toFixed(4) + "</span><span>Output: " + row.outputTokens.toLocaleString() + " tokens</span>";
      tip.style.display = "block";
      tip.style.left = Math.min(rect.width - 230, Math.max(4, x + 10)) + "px";
      tip.style.top = Math.min(rect.height - 62, Math.max(38, y)) + "px";
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    }
    addEventListener("resize", drawCloud);
    drawCloud();
  </script>
</body>
</html>`;
}

function bars(rows, getValue, max, colorClass, format) {
  return rows.map((row) => {
    const value = getValue(row);
    const width = Math.max(0, Math.min(100, (value / max) * 100));
    return `<div style="display:grid;grid-template-columns:minmax(150px,220px) 1fr 82px;gap:10px;align-items:center;margin:10px 0"><span>${escapeHtml(row.label)}</span><div class="bar ${colorClass}"><i style="width:${width}%"></i></div><strong>${row.ran ? format(value) : "n/a"}</strong></div>`;
  }).join("");
}

function utility(row) {
  if (!row.ran) return -Infinity;
  const costPenalty = Math.min(0.4, (row.measuredCost || 0) * 20);
  const latencyPenalty = Math.min(0.25, (row.averageDurationMs || 0) / 180000);
  return (row.score || 0) - costPenalty - latencyPenalty;
}

function classifyBlockedReason(tasks) {
  if (!tasks.length) return null;
  const errors = tasks.map((task) => task.error).filter(Boolean);
  if (errors.length !== tasks.length) return null;
  if (errors.every((error) => /Missing OpenRouter key/i.test(error))) return "Missing OpenRouter API key";
  return null;
}

function slug(id) {
  return id.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatMoney(value) {
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
