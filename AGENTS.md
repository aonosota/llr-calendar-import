# AGENTS.md — llr-calendar-import

Obsidian plugin: imports ICS calendar events into daily notes as LLR task lines.
Spec: `docs/requirements.md` (section 0.1 decisions override the rest).

## Rules
- `src/types.ts` and `src/time.ts` are the shared contract. Do NOT edit them; if a change is needed, ask the coordinator.
- Pure modules (`src/source/ics`, `src/llr`, `src/section`, `src/insert`) must not import `obsidian` and must not use Node APIs (mobile support). Inject I/O.
- Never put calendar URLs in logs, errors or notices.
- Tests: vitest, colocated `*.test.ts`, TZ is pinned to Asia/Tokyo in `vitest.config.ts`.
- Gate: `npm test && npm run typecheck` must pass.
- Respond to the user in Japanese; code/comments in English.
