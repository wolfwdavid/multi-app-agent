# System & Reliability Brief

## 1. What it does
_One paragraph: the user problem and the end-to-end outcome._

## 2. Architecture
- **Agent loop:** _model, planner/executor, tool-calling_
- **Connected apps (≥3):**
  1. _App — what the agent reads/writes_
  2. _App — …_
  3. _App — …_

## 3. Reliability measures
- _Input/output schema validation on every tool call_
- _Retries with backoff; idempotency keys for writes_
- _Human approval gate before irreversible actions_
- _Dry-run mode against mock apps_

## 4. Evaluation
| Scenario set | Runs | Success rate | Notes |
|---|---|---|---|
| _happy path_ | | | |
| _edge cases / failures injected_ | | | |

## 5. Known limitations
- _…_
