# Maison Passage Gateway Pair Explorer

`build/` contains the runnable Next.js app for the current Maison Passage overseas gateway-pair planner.

## Product Snapshot

- Current purpose: help a traveler compare the cheapest outbound and return one-way tickets for a multi-country overseas trip before moving to live search.
- Current search model: selected destination countries act as the headline stay countries, while nearby gateway airports may also be searched when that produces a cheaper international entry or exit.
- Current Europe realism layer: when non-direct routes are allowed, Europe searches may add low-cost corridor gateways such as Hungary / Budapest and Czech Republic / Prague, and allow higher-stop budget corridors to undercut cleaner hub-first routes.
- Current planner scope: those corridor gateways stay internal to the gateway-expansion logic and result folio, rather than appearing as new primary destination picker options.
- Current pricing model: fares in the app are deterministic reference estimates unless a future live provider is added.
- Current estimate integrity: deterministic fares are shown with ranges, confidence labels, and estimate-basis notes before live search handoff.
- Current handoff layer: outbound, return, and combined Skyscanner searches are presented as structured near-live fare source cards that stay clearly separate from deterministic estimates and act as the single primary live-search handoff surface.
- Current fallback policy: if the provider link fails or returns no usable fare, the interface says so honestly and preserves the deterministic estimate as the fallback reference.
- Current flexible planning: users can compare multiple target outbound months, such as July through September, and choose an approximate stay range such as 26 to 36 days before exact dates are fixed.
- Current planner clarity: before search, the form shows selected stay countries separately from any automatically expanded gateway countries so the comparison pool is explicit.
- Current shell: the app wraps the planner in a Bauhaus-leaning neo-brutalist travel atelier built on the Grand Tour Ledger structure.
- Current typography and motion: `Noto Sans JP` drives Japanese hierarchy, `Oswald` is reserved for numeric moments and route codes, hover states lift softly over `0.3s`, and major sections reveal with staggered spring-like motion.
- Roadmap note: Europe corridor overlay realism is now Sprint 8, and live fare handoff cards follow it in Sprint 9.

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
npm run typecheck
npm run test:planner
npm run smoke
npm run build
```

`npm run test:planner` validates the deterministic gateway-pair planner logic, including price ranges, confidence labels, gateway expansion, corridor overlay behavior, the between-ticket note, and Skyscanner handoff generation. It also verifies flexible month comparison and the 26 to 36 day return window.

`npm run smoke` starts the Next.js app on `127.0.0.1:3100`, uses an isolated `.next-smoke` dist directory, fetches the rendered page, confirms key Maison Passage text is present, stops the temporary server, and exits.

## Scope Boundaries

- The current planning flow focuses on choosing the cheapest two-ticket international shell of the trip.
- Internal travel between arrival and departure airports is intentionally out of scope for the MVP.
- Final fare confirmation should happen in the live search handoff, not inside the deterministic reference UI.
