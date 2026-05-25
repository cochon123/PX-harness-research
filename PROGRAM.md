# PX Harness Program Rules

These rules apply when an autonomous agent is asked to improve the harness.

- Do not edit expected answers, grader logic, benchmark labels, score reports, or holdout tasks to improve a score.
- Do not hide failed runs, delete trace artifacts, or change reporting code to make results look better.
- Do not add task-specific shortcuts that only solve one known benchmark item unless the task explicitly asks for that fixture.
- Do not claim an improvement from train results alone; compare against the agreed dev set, then review the patch.
- If a rule or grader looks wrong, report it separately instead of silently changing it during an optimizer run.

