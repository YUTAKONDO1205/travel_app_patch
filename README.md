# Travel App Patch

This repository contains the Maison Passage Open Jaw Explorer and the local Codex harness that plans, generates, and evaluates it.

## What This Builds

Maison Passage is a premium overseas open-jaw travel planner. It compares representative airports across multiple destination countries, finds a low-cost outbound entry leg, then finds a low-cost return exit leg while intentionally leaving internal travel out of scope.

The current app already supports flexible seasonal planning: a traveler can choose multiple outbound months such as July, August, and September, then choose an approximate stay range such as 26 to 36 days. The planner picks the cheapest outbound date first and searches return dates from that outbound date plus the selected stay range.

The next approved sprint is `Sprint 5: Grand Tour Ledger Redesign`. That redesign keeps the existing overseas open-jaw planner, flexible month comparison, and stay-window behavior, but reframes the experience as a much bolder premium dossier with this section order:

- `Header`
- `Cover Spread`
- `Proof Strip`
- `Planner Atelier`
- `Result Folio`
- `Story/Method Rail`
- `Archetypes`
- `Concierge CTA`
- `Footer`

Live fare enrichment is now deferred to `Sprint 6` so the dossier redesign lands first.

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
python agents/orchestrator_codex.py autodev "Advance Maison Passage toward the Grand Tour Ledger dossier redesign" --sprint 5 --max-iterations 3
```

The harness treats `specs/spec.json` as the product truth, updates `build/`, writes `sprints/sprint_N_eval.json`, and writes `evaluations/sprint_N_report.json`.
