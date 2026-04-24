# Travel App Patch

This repository contains the Maison Passage Gateway Pair Explorer and the local Codex harness that plans, generates, and evaluates it.

## What This Builds

Maison Passage is a premium overseas travel planner that searches the trip as two one-way tickets. It compares representative airports across multiple destination countries, widens the search to nearby gateway airports when useful, finds a low-cost outbound one-way, then finds a low-cost return one-way while intentionally leaving internal travel out of scope.

The current app supports flexible seasonal planning: a traveler can choose multiple outbound months such as July, August, and September, then choose an approximate stay range such as 26 to 36 days. The planner picks the cheapest outbound date first and searches return dates from that outbound date plus the selected stay range.

The planner now also separates the selected stay countries from any automatically expanded gateway countries before search, so the traveler can see exactly how the international entry and exit pool is being widened.

The current approved roadmap is:

- `Sprint 5`: Grand Tour Ledger Redesign
- `Sprint 6`: Gateway Pair Ticketing
- `Sprint 7`: Bauhaus Motion Refresh
- `Sprint 8`: Live Fare Enrichment

## Repository Layout

- `build/`: the runnable Next.js app.
- `agents/`: the local Codex planning, generation, and evaluation harness.
- `specs/spec.json`: product source of truth.
- `設計書.md`: human-readable design companion.
- `sprints/`: generator self-evaluation artifacts.
- `evaluations/`: evaluator reports.

## Run The App

```bash
cd build
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Validate

```bash
cd build
npm run typecheck
npm run test:planner
npm run smoke
npm run build
```

## Harness

From the repository root:

```bash
python agents/orchestrator_codex.py status
python agents/orchestrator_codex.py autodev "Advance Maison Passage toward gateway-first two-ticket travel planning" --sprint 6 --max-iterations 3
```

The harness treats `specs/spec.json` as the product truth, updates `build/`, writes `sprints/sprint_N_eval.json`, and writes `evaluations/sprint_N_report.json`.

The harness is organized around three local sub-agent roles:

- `Planner`: expands a short request into `specs/spec.json` without over-specifying implementation details.
- `Generator`: implements one sprint at a time and leaves a self-evaluation handoff in `sprints/`.
- `Evaluator`: validates the sprint strictly and writes a `PASS` or `FAIL` report in `evaluations/`.

The handoff contract is now bug-aware:

- `Evaluator` writes structured `bugs` entries with stable `bug_id` values when a sprint fails.
- `Generator` copies the bug ids it is responding to into `source_bug_ids`, then classifies them with `addressed_bug_ids` and `unresolved_bug_ids` in `sprints/sprint_N_eval.json`.
- `status` surfaces the latest bug linkage so it is obvious which findings were classified, which remain open, and whether the current report, when it is `FAIL`, still matches the generator's source bug set.

`python agents/orchestrator_codex.py status` now returns an agent-centric JSON view of the pipeline, including planner/generator/evaluator readiness, read/write contracts, structural validation of the latest artifacts, summary metadata for the latest sprint/report, bug-linkage summaries, local git sync readiness, and the latest evaluation status.

`autodev` now reuses the existing `specs/spec.json` by default so Planner remains the spec-authoring role, while Generator and Evaluator iterate on the current sprint. Pass `--replan` when you intentionally want to regenerate the spec first.

## Current Design Direction

The current UI direction is a Bauhaus-leaning neo-brutalist travel atelier. The app uses `Noto Sans JP` with visible weight contrast for Japanese hierarchy, `Oswald` for numeric callouts and route codes, a warm off-white field with red, blue, yellow, and near-black accents, soft `0.3s` lift hover motion, and staggered spring-like scroll reveals.
