---
name: prd-parse
description: Turn an approved PRD into a parent feature work item that references it by path
args: "<slug>"
---

# Workflow: prd-parse

Load and follow this workflow to turn an APPROVED PRD into the feature
work item that will deliver it. The judgment is scope and lane; the
mechanics are exactly the CLI calls below. Never hand-edit anything under
`nahel/`.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

1. Check the gate. Find the plan item whose `prd` field names
   `docs/prds/<slug>.md` (`nahel status` shows `prd=` on item lines). Its
   status must be `done` — the approval flip (ADR-0013). If it is not,
   STOP and say so: parsing an unapproved PRD skips the gate.

   Whose flip that is depends on the project's `governance.product`
   (`nahel brief`): under `human` it is the human's, unchanged; under
   `delegated` — also how a project that declared no governance behaves —
   a runner may have granted it by the cross-vendor consensus
   `nahel/workflows/afk-run.md` step 6 defines. The exception covers
   plan-item approval only, and the gate is identical either way: `done`,
   or STOP.

   Audit a delegated flip in `nahel progress --item <plan-id>`. The trail
   being PRESENT is not the audit — a disagreeing verification, or one bound
   to bytes the PRD has since moved past, accompanies an agent-set `done`
   just as comfortably as a real approval does. All five hold, or the flip
   is not an approval:

   a. The proposal event ("PRD proposed for delegated approval") names this
      PRD and carries a `revision` and an `assumptions` list.
   b. A verification event under ANOTHER vendor's actor carries
      `verdict=agree` and `verifies=<the proposal event id>`. A
      `verdict=disagree` is a refusal that was overridden; treat it as such.
   c. The PRD still IS what was verified — so re-hash it now, at parse
      time; the event's own copy of the hash proves nothing about the file
      on disk:

          git hash-object docs/prds/<slug>.md

      That output must equal the `revision` on the proposal AND on the
      verification. A hash that moved means the approved bytes are not the
      bytes you are about to decompose: not approved.
   d. Every assumption event id the proposal cites is actually in the
      journal. The trail is what the interview was traded for; an approval
      resting on assumptions nobody can read rests on nothing.
   e. The decision event
      ("delegated approval (governance.product=delegated)") links the two by
      id — its `proposal` and `verification` naming exactly the events you
      just audited, at that same `revision`.

   Any of those failing — and a `done` an agent flipped with neither this
   trail nor a human's word — means NOT approved: refuse to parse, and park
   the plan item so the human whose gate was skipped can see it:

       nahel item update <plan-id> --status blocked
       nahel log note --item <plan-id> \
         --data summary="parked: delegated approval does not audit — <which of (a)-(e) failed, with the event ids and hashes you compared>; PRD not parsed"

   Then stop. Never re-run the consensus yourself to repair someone else's
   approval: proposing and verifying the same PRD is not cross-vendor review.

2. Read the PRD end to end, then verify its scope against the actual code:
   what already exists, which surfaces the requirements touch, the real
   size of what remains. Scope is what you verified, not what the PRD
   assumes.

3. Choose the lane from that verified scope:
   - `direct` — one focused change, a handful of files, no decomposition
     needed. Rare for anything worth a PRD; say why if you pick it.
   - `epic-lite` — one coherent feature, a few session-sized deliverables,
     light ordering.
   - `full` — multi-deliverable or cross-cutting; needs real decomposition
     with dependency ordering.

4. Create the parent feature item — it prints its generated id:

       nahel item new feature <slug> <lane> --prd docs/prds/<slug>.md

5. Journal the link so the trail survives compaction:

       nahel log note --item <feature-id> \
         --data summary="Parses docs/prds/<slug>.md (authored by plan item <plan-id>)"

6. Next: `direct` goes straight to the task-lifecycle workflow;
   `epic-lite` and `full` go to epic-decompose first.

Fallback (degraded environment): if the `nahel` CLI is unavailable, read
the PRD and report the lane you would choose, but create nothing — items
and journal entries are CLI-maintained state. Record the pending mechanics
so a CLI-equipped session can perform them.
