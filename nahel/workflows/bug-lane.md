---
name: bug-lane
description: Work a bug diagnosis-first — investigation doc, failing repro test before any fix, waiver only after documented failed attempts
args: "<item-id>"
---

# Workflow: bug-lane

Branch note: the fix lives on `fix/<slug>` and lands via a reviewed PR —
never directly on the default branch (task-lifecycle's git discipline).

Load and follow this workflow to work a `bug` item. Diagnosis comes first:
understand the failure before touching the fix. All lifecycle mechanics —
status flips, the run, journaled findings, the claim rule — are the
task-lifecycle workflow's; follow it alongside this one. Every state change
is a CLI call; never hand-edit anything under `nahel/`.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

1. Open the bug. Confirm the item exists and is yours to work (`nahel
   status`), or create it, then start it per task-lifecycle:

       nahel item new bug <slug> direct
       nahel item update <item-id> --status in-progress
       nahel run start <item-id>

2. Open the investigation — the bug's durable diagnosis document, at
   `docs/investigations/<item-id>.md` by convention. It is a LIVING doc:
   symptoms, repro status, hypotheses tested, root cause — updated as
   diagnosis proceeds, not written after the fact. Record it on the item:

       nahel item update <item-id> --investigation docs/investigations/<item-id>.md

3. Diagnose. Use the pinned diagnosing-bugs skill when installed; without
   it, apply its core inline: reproduce the failure, isolate the smallest
   failing surface, hypothesize a cause, and test hypotheses one at a time —
   never batch them, or a passing test proves nothing. Journal each tested
   hypothesis and its result (`nahel log note`, per task-lifecycle); write
   what you learn into the investigation as you go.

4. HARD RULE — the failing repro test comes before any fix. Commit a test
   that is red for the bug's exact cause, then make it green: the tdd
   posture from task-lifecycle, and the proof the fix fixes anything. A fix
   without a repro test is unverified speculation.

5. Waiver path — ONLY when the investigation documents failed repro attempts.
   If honest attempts to reproduce have failed and the investigation says so,
   the repro requirement may be waived — never silently skipped. The waiver
   is an ordinary observation, tagged and tied to the bug:

       nahel observe repro-waived-<slug> --item <item-id> \
         --data body="Repro waived: <why attempts failed>." \
         --data sources='["<journal-event-id-of-each-failed-attempt>", ...]' \
         --data tags='["repro-waiver"]'

   `sources` must cite the journal events of the failed attempts (step 3
   journaled them). `nahel brief` surfaces the waiver while the bug is open,
   and the eventual PR body must state it too. A waiver without documented
   failed attempts is invalid — go back to step 3.

6. Close. Distill the root cause into an observation with provenance to the
   journal events that revealed it:

       nahel observe root-cause-<slug> --item <item-id> \
         --data body="<the root cause, stated so it stands alone>" \
         --data sources='["<event-id>", ...]'

   Then end honestly and hand the item to review, per task-lifecycle:

       nahel run end <run-id> success
       nahel item update <item-id> --status in-review

   `done` is not yours to grant — a bug reaches it only at the human's word,
   and only carrying its repro test or its surfaced waiver. Human-only with
   no exception — even when the PR auto-merged under `merge: on-approve`,
   and regardless of `governance.product: delegated`, which delegates
   plan-item approval only (`nahel/workflows/afk-run.md` step 6).

Fallback (degraded environment): if the `nahel` CLI is unavailable, the
diagnosis, the investigation doc, and the repro test may all proceed — they
are code and prose — but make NO status, run, journal, or observation
mutations; report which mutations are pending so a CLI-equipped session can
record them. If the diagnosing-bugs skill is not installed, the inline loop
in step 3 is its fallback: reproduce, isolate, hypothesize, test one at a
time.
