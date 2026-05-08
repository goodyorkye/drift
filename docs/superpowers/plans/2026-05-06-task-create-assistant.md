# Task Create Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build phase 1 of the Web creation workbench so users can create a task draft, collaborate with a creation assistant inside the draft `spec/` directory, and finalize the draft into a real task.

**Architecture:** Add a draft subsystem under `workspace/drafts/tasks/<draftId>/` with explicit metadata, file access helpers, and finalize logic in core modules. Extend the Web API with draft and assistant endpoints, then add a dedicated task-creation workbench in the React client that manages files, assistant rounds, and final creation actions.

**Tech Stack:** TypeScript, Node.js `fs/promises`, existing runner/creation helpers, React, Vite, Vitest.

---

### Task 1: Draft Domain Model And Storage Helpers

**Files:**
- Modify: `src/paths.ts`
- Modify: `src/types.ts`
- Modify: `src/storage.ts`
- Create: `src/core/task-drafts.ts`
- Test: `test/task-drafts.test.ts`

- [ ] Add draft paths, draft metadata types, and storage helpers for `workspace/drafts/tasks/<draftId>/`.
- [ ] Cover create/read/list file/read file/write file/finalize preconditions in `test/task-drafts.test.ts`.
- [ ] Verify with: `npm test -- --run test/task-drafts.test.ts`

### Task 2: Assistant Round Execution

**Files:**
- Modify: `src/cli/creation.ts`
- Modify: `src/types.ts`
- Modify: `src/core/task-drafts.ts`
- Test: `test/creation.test.ts`

- [ ] Extract a reusable non-interactive creation-assistant round helper that can run against a draft `spec/` directory and return assistant text plus updated transcript state.
- [ ] Store transcript messages in draft metadata so each assistant round remains grounded in prior user/assistant context.
- [ ] Add tests for prompt construction/transcript carry-forward in `test/creation.test.ts`.
- [ ] Verify with: `npm test -- --run test/creation.test.ts`

### Task 3: Web Draft API

**Files:**
- Modify: `src/web/server.ts`
- Modify: `src/core/actor.ts` (only if helper reuse is needed)
- Modify: `src/core/task-drafts.ts`
- Test: `test/web.test.ts`

- [ ] Add task draft endpoints: create draft, get draft, list files, read file, write file, assistant round, and finalize task.
- [ ] Keep write endpoints behind actor + read-only checks and reuse the same audit conventions as other Web write operations.
- [ ] Add route-level tests in `test/web.test.ts` for the new draft endpoints.
- [ ] Verify with: `npm test -- --run test/web.test.ts`

### Task 4: Task Create Workbench UI

**Files:**
- Modify: `src/web/client/src/main.tsx`
- Modify: `src/web/client/src/styles.css`

- [ ] Add a `New Task` entry point in the tasks view.
- [ ] Build a creation workbench with file list, `task.md` editor, assistant panel, and final confirmation controls.
- [ ] Support draft refresh, task.md save, assistant message send, and finalize as `not_queued` or enqueue.
- [ ] Keep first-run defaults conservative: title can start empty, runner defaults come from task type, and create actions stay disabled until `task.md` is non-empty.

### Task 5: Docs And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/decisions/0009-web-ui.md`
- Modify: `docs/decisions/0010-web-creation-workbench.md`

- [ ] Document the new Task Create Assistant workflow, draft directory model, and current first-phase scope.
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm test -- --run`
- [ ] Run: `npm run build:web`
- [ ] Run: `npm run build`
