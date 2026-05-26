# PX Harness Research

V1 is a dependency-light baseline harness for the current Perso XXL planner.

It does not try to be the final browser harness yet. It creates local structured
web fixtures, sends the same kind of prompt/context that the extension sends to
OpenRouter, validates the returned transform plan, matches selectors against the
fixture DOM, scores deterministic expectations, and writes HTML/JSON reports.

Run:

```sh
npm run baseline
```

Browser-mode baseline:

```sh
npm run baseline:browser
```

Run the browser baseline repeatedly for stability stats:

```sh
npm run baseline:browser -- --runs=10
```

Skip tasks that already meet a previous pass-rate threshold:

```sh
npm run baseline:browser -- --runs=10 --skip-pass-rate=0.9
```

By default the skip decision reads `reports/browser-baseline.json`. Use
`--skip-source=path/to/report.json` to compare against a different baseline.

Run only a focused slice of tasks:

```sh
npm run baseline:browser -- --runs=10 --tags=youtube-focused
npm run baseline:browser -- --tasks=medium-youtube-hide-creator-typo,medium-youtube-hide-creator-exact
```

Browser mode starts the local web-zoo app, launches Chromium or Chrome, runs low-reasoning
tasks, applies plans to actual DOM pages, captures before/after screenshots, and
writes `reports/browser-baseline.html` plus `reports/browser-baseline.json`. The
HTML report includes a human review table with task intent, screenshots,
pass/fail state, failure reason, semantic target candidates, selector diagnostics,
and expandable per-task logs.

The runner prefers `/snap/bin/chromium`, then other Chromium paths, then
Google Chrome. If the selected browser cannot load unpacked extensions, it
falls back to injecting Perso's DOM/executor scripts into the fixture pages and
using the Node OpenRouter planner. That fallback still tests real browser DOM
execution, but not extension loading.

The runner reads the OpenRouter key from `/home/cochon/Documents/Perso-XXL/config/env.js`
or `/home/cochon/Documents/Perso-XXL/.env`.
