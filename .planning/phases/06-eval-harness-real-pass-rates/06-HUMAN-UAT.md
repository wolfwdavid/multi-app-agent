---
status: partial
phase: 06-eval-harness-real-pass-rates
source: [06-VERIFICATION.md]
started: 2026-09-13T20:36:00Z
updated: 2026-09-13T20:36:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live Ollama eval column
Run from `web/` while Ollama is idle: `npm run eval -- --llm ollama --n 1 --scenarios happy-path,injection-essay-doc`
expected: evals.json gains an `llm-ollama` column for those two scenarios. The fake columns stay byte-identical, and evals.md shows the real LLM cells plus an `LLM columns:` line. The run takes about 800 s per scenario on CPU.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
