# Codex migration starter for Travel App

This package adds a Codex-friendly layer to the existing Travel App pipeline.

## Included files
- `AGENTS.md`
- `.codex/config.toml`
- `.agents/skills/planner/SKILL.md`
- `.agents/skills/generator/SKILL.md`
- `.agents/skills/evaluator/SKILL.md`
- `agents/codex_runner.py`
- `agents/orchestrator_codex.py`

## Recommended install order
1. Copy these files into the repository root.
2. Install Codex CLI:
   - `npm i -g @openai/codex`
3. If you want to use non-interactive pipeline execution with API key auth, set `CODEX_API_KEY`.
4. From the repo root, try:
   - `python agents/orchestrator_codex.py status`
   - `python agents/orchestrator_codex.py plan "Create a travel planning app"`
   - `python agents/orchestrator_codex.py generate 1`
   - `python agents/orchestrator_codex.py evaluate 1 http://localhost:3000`

## Notes
- `orchestrator_codex.py` is additive. It does not overwrite your existing `orchestrator.py`.
- The evaluator skill prefers Playwright MCP if available. If not configured, it falls back to honest local validation and notes that limitation.
- You can later replace the original planner/generator/evaluator internals if you want a full migration.
