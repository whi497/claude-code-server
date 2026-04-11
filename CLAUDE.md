# AGENTS.md — claude-code-server

This file governs the entire repository.

## Session Conversion Rules

When touching "convert to session", "pin as session", or resume behavior, keep these concepts separate:

- `job.status` describes runtime state. Only `running` and `idle` mean there is a live in-memory execution path.
- `job.mode` describes how the next successful turn should be retained: one-shot `job` vs persistent `session`.
- `job.sessionId` describes whether the SDK gave us a resumable conversation handle.

Do not treat `mode === 'session'` as equivalent to "there is already a live idle session".

Implementation rules:

- Only show `idle` / `Session Active` when there is a real live session attached for that job.
- `Pin as Session` is for a currently live `idle` job. It should cancel the idle auto-complete timer and keep the current channel alive.
- A completed/failed job with `sessionId` can be resumed, but converting it to session mode should be described as a resume preference unless the backend truly re-attaches a live session immediately.
- A completed/failed job without `sessionId` is not resumable. Prefer explicit UX copy over silently hiding the reason.
- If backend semantics change, update `server/src/index.ts`, `client/src/components/JobDetail.tsx`, and `README.md` in the same change.

## Resume Semantics

`/api/jobs/:id/keep-alive` should keep these behaviors distinct:

- For `idle` jobs it pins the current live job as a session.
- For `completed`/`failed` jobs with `sessionId` it should re-attach the resumable session immediately so the job becomes live `idle`.
- For `completed`/`failed` jobs without `sessionId` it must not pretend a true resume is possible. If follow-up is allowed, describe it as a fresh run on the same job record.
