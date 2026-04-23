# Maison Passage Open Jaw Explorer

`build/` contains the runnable Next.js app for the latest Maison Passage product direction: an overseas open-jaw planner wrapped in a luxury editorial landing experience.

## Product Snapshot

- Purpose: help a traveler compare the cheapest inbound entry leg and cheapest return exit leg for a multi-country overseas trip before moving to live search.
- Core truth: prices in the app may be deterministic reference estimates unless a future live provider is added.
- Design direction: warm off-white backgrounds, gold and bronze accents, dark brown and near-black contrast, and a calm premium rhythm instead of a dense utility dashboard.
- Required page shell: fixed transparent header, full-screen hero, concept intro, value collage, alternating story section, lineup cards, restrained CTA, and dark footer.

## Run Locally

From the `build/` directory:

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Dev Server Notes

`npm run dev` calls [`scripts/dev.ps1`](/C:/Users/PC_User/travel_app_patch/build/scripts/dev.ps1), which starts Next.js on port `3000`.

On Windows, that script checks for an existing listener on port `3000` and attempts to stop it before launching the app. If the port cannot be freed, the command exits with a clear error so the conflict can be resolved manually.

## Build Validation

After installing dependencies:

```bash
npm run build
```

For this Codex desktop sandbox, where `node:child_process` may be blocked, use the same-process dev smoke instead:

```bash
npm run smoke
```

The smoke command starts the Next.js app on `127.0.0.1:3100`, fetches the rendered page, confirms key Maison Passage text is present, stops the temporary server, and exits.

## Harness Notes

The repository's Codex harness reads `specs/spec.json` as the product source of truth and uses these commands from the repo root:

```bash
python agents/orchestrator_codex.py plan "<description>"
python agents/orchestrator_codex.py generate <sprint>
python agents/orchestrator_codex.py evaluate <sprint> http://localhost:3000
python agents/orchestrator_codex.py autodev "<description>" --sprint N --max-iterations M --url http://localhost:3000
python agents/orchestrator_codex.py status
```

`autodev` runs `plan`, then loops through `generate` and `evaluate`. If `build/package.json` exists, it also attempts `npm install`, starts the local dev server, waits for `http://localhost:3000`, and passes evaluator feedback into the next generate attempt when a sprint fails.

## Scope Boundaries

- The current planning flow focuses on the overseas open-jaw entry and exit decision.
- Internal travel between arrival and departure airports is intentionally out of scope for the MVP.
- Final fare confirmation should happen in the live search handoff, not inside the deterministic reference UI.
