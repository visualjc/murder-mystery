---
name: task-lifecycle
description: Work a leaf item start to close — status flips, a run with honest phases, journaled findings
args: "<item-id>"
---

# Workflow: task-lifecycle

Load and follow this workflow to execute one leaf work item — an item with
no children, whatever its type. Every state change below is a CLI call;
never hand-edit anything under `nahel/`.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

The claim rule, before anything: if a mutation is refused because a claim
covers the item (its own `claimed_by`, or a claimed ancestor — claims
cover the whole subtree), STOP and surface the refusal to the human
verbatim. Never work around a claim — not by retrying as another actor,
not by moving the item, not by hand-editing. The claim is the human's word
that this work is theirs.

0. Git discipline, before any code: CODE changes never land on the default
   branch directly. Work on a branch — `epic/<slug>` for a feature epic's
   children (one shared branch per epic), `fix/<slug>` for a lone bug,
   `chore/<slug>` otherwise — and finish by opening a PR for review; merging
   is the human's (or their standing protocol's) call. Nahel STATE mutations
   (`nahel/` records and journal) are the exception: the CLI's merge-safe
   store commits to the default branch directly.

1. Start — flip the item, open a run:

       nahel item update <item-id> --status in-progress
       nahel run start <item-id>

   `run start` prints the run id; the steps below carry it.

2. Work in phases, and keep the run's phase honest as you move:

       nahel run update <run-id> --phase <phase>

   Phase names are workflow-owned (`red`, `green`, `refactor`, `verify`,
   …). TDD posture: the failing test comes FIRST — red before green — and
   you never weaken an existing assertion to get there. Use the pinned tdd
   skill when installed; the red-first rule stands without it.

3. Journal load-bearing findings the moment you have them — decisions,
   surprises, constraints discovered the hard way; not routine progress:

       nahel log note --item <item-id> --run <run-id> --data summary="<the finding>"

4. Blocked? Record it durably, then stop or switch:

       nahel item update <item-id> --status blocked
       nahel log note --item <item-id> --data summary="blocked: <reason>"

   Surface the reason to the human — a blocked item with no journaled
   reason is a dead end for the next session.

5. Close. End the run with its honest outcome, then hand the item to
   review:

       nahel run end <run-id> success
       nahel item update <item-id> --status in-review

   A failed attempt still closes: `nahel run end <run-id> failure` — an
   abandoned `active` run is a lie in the state. `done` is not yours to
   grant: the item flips to `done` only after the human merges or accepts
   the work. Human-only with no exception:
   even when the PR auto-merged under `merge: on-approve`, merging is a
   repository act and accepting the work is the human's; and
   `governance.product: delegated` delegates plan-item approval only
   (`nahel/workflows/afk-run.md` step 6), never a leaf item's `done`.

6. Confirm the shape: `nahel status` — the run closed, the item
   `in-review` (or `blocked` with its journaled reason).

Fallback (degraded environment): if the `nahel` CLI is unavailable, the
work itself may proceed — code, tests, prose — but make NO status, run, or
journal mutations; report what you did and which mutations are pending so
a CLI-equipped session can record them. If the tdd skill is not installed,
the inline posture in step 2 is its fallback: red first, always.
