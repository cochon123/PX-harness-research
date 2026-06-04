import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const MODELS = [
  "xiaomi/mimo-v2.5-pro",
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "minimax/minimax-m2.7",
  "minimax/minimax-m3",
  "google/gemma-4-26b-a4b-it",
  "google/gemma-4-31b-it",
  "qwen/qwen3.6-plus",
  "x-ai/grok-4.3",
  "qwen/qwen3.5-9b"
];

const tags = arg("tags", "youtube-focused");
const runs = arg("runs", "1");
const contextMode = arg("context-mode", "domfs");
const runDir = arg("run-dir", "reports/model-runs");
mkdirSync(runDir, { recursive: true });

for (const model of MODELS) {
  const output = `${runDir}/${slug(model)}`;
  await run("node", [
    "runner/browser-baseline.mjs",
    `--model=${model}`,
    `--runs=${runs}`,
    `--context-mode=${contextMode}`,
    `--tags=${tags}`,
    "--keep-screenshots=true",
    "--headless=true",
    `--output=${output}`
  ]);
}

await run("node", ["runner/model-comparison-report.mjs", `--run-dir=${runDir}`, "--output=reports/model-cost-analysis.html"]);

function run(command, args) {
  console.log(`[model-comparison] ${command} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

function arg(name, fallback) {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=")[1] || fallback;
}

function slug(id) {
  return id.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
}
