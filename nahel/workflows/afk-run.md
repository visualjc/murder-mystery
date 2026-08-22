---
name: afk-run
description: Run a project AFK — autonomy gate, scope discovery, lane picks, dispatched waves, review, and one verified draft PR per epic, with zero human turns
args: "<kickoff line>"
---

# Workflow: afk-run

Load and follow this workflow to run a project AFK: one kickoff line in, one
verified draft PR per epic out, with ZERO human turns in between. Any capable
agent can be the runner. The mechanics are CLI calls — `nahel dispatch` spawns
every worker, `nahel item` / `nahel run` / `nahel log` record every state
change; every judgment is yours (ADR-0016). Reading state files is fine;
mutating them by hand is not. Never hand-edit anything under `nahel/`.

Every step below is a shell command or a paragraph of judgment, so the whole
run is drivable by pure conversation — no host-agent feature is required, and
nothing here is specific to one vendor's tooling.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.
That id is also your VENDOR identity: the cross-vendor rules below compare it
against the agent a route names.

THE RULE THAT MAKES A RUN AFK — **never ask mid-run**. A question asked into an
empty room stalls everything. Any decision you are not authorized to make
becomes a PARK (step 12): a journaled reason plus a `blocked` status the brief
surfaces, and the run continues elsewhere.

The claim rule, unchanged from task-lifecycle: a mutation refused because a
claim covers the item is the human's word that this work is theirs. Stand down
on it (step 3); never work around a claim.

1. Gate the run — the autonomy gate. An AFK run is refused unless all three
   artifacts below are recorded. Check them in order; on the first failure
   STOP, state the refusal naming the missing artifact and the workflow that
   produces it, and run nothing else. Interactive work is ungated: this gate
   binds AFK runs only.

   a. **A human-signed constitution.** Read `nahel/config`: its `inception`
      section must carry `constitution_signed_by`, and the `config.updated`
      act that wrote that section must be attributed to a HUMAN actor —
      `nahel progress` renders every event with its actor and payload:

          nahel progress | grep config.updated

      An agent-attributed signature is not a signature (the same rule merge
      authority applies to `merge: on-approve`): treat it as unsigned.
      Refusal: "no human-signed constitution — run the inception workflow
      (`nahel/workflows/inception.md`) and have the human record the
      signature themselves." Never infer a signature from prose in the
      constitution document; the gate reads recorded state only.

      One founding spends the human's single act elsewhere. When
      `nahel/config` carries a `founding` section with `mode: hands-off`, the
      signed content is that section's verbatim paragraph — so the act to
      check for human attribution is the `config.updated` that wrote
      `founding`, and the tier record itself may be agent-attributed (the
      human was gone by then; `nahel/workflows/inception.md`). Only the act
      being read changes: an agent-attributed founding act is no signature
      either, and `constitution_signed_by` must still be recorded.

      Legacy repos: a store founded before this gate existed (section absent,
      or the signer transcribed by an agent from a journal note) fails exactly
      this check — `nahel validate` surfaces it as `inception.unsigned`. The
      migration is one command the human runs themselves, re-recording the
      whole section (`nahel config set inception --data tier=<tier> --data
      'constitution_signed_by=<their id>'`); journal notes never substitute
      for the recorded act.

   b. **A passing run contract:**

          nahel doctor

      The gate is satisfied by EITHER of two states, and by nothing else:

      - **Exit 0** — the contract holds on this machine. Proceed.
      - **Exit 3 or Exit 4 WITH a journaled first-scaffold obligation** — the
        deferred-proof case, and the only failure the gate admits. A founding
        on an empty repo records `standard` with the doctor proof deferred as
        an obligation (`nahel/workflows/inception.md`, "Tier honesty"),
        because a contract's proof cannot precede the app it checks. Read the
        obligation from recorded state before relying on it:

            nahel progress | grep "first-scaffold obligation"

        With that event present, the run starts and the obligation is
        DISCHARGED at step 9a — `nahel doctor` must exit 0 there, before any
        PR opens. Without it, exit 3 refuses naming the unset env vars doctor
        listed (they belong in this machine's gitignored env file), and exit 4
        refuses naming the failing healthcheck.

      **Exit 2 refuses always**, obligation or not: "no passing run contract —
      the `contract` section is missing; run the inception workflow
      (`nahel/workflows/inception.md`)". Same for a malformed config (exit 1).
      The obligation defers the run contract's PROOF and
      never the contract itself — an unrecorded contract has nothing to prove
      later, and a run that cannot even name how the app launches cannot
      verify by driving (step 9).

   c. **A recorded inception tier:** `nahel/config`'s `inception` section
      must carry `tier`. Refusal: "no recorded inception tier — run the
      inception workflow (`nahel/workflows/inception.md`)". The tier is load
      bearing later too: a `seed` project never gets delegated approval
      (step 6).

   The verdict is deterministic — identical repo state yields the identical
   verdict on any machine, and no step of it is a judgment call. If you find
   yourself weighing whether a constitution "feels" signed, the answer is no.

2. Journal the kickoff line verbatim, before interpreting it:

       nahel log note --data summary="afk-run kickoff: <the kickoff line, verbatim>"

   The line is the run's charter; the trail must show what was asked, not only
   what you decided it meant.

3. The checkpoint check — where a human's intervention actually reaches a
   running loop. Run it at every checkpoint boundary:

       nahel status

   That one read renders every item's `claimed_by` and every run's status;
   that is the whole check.

   **The boundaries, all of them**: before every dispatch (step 8);
   before every phase transition on an item — the verify run's `run start` /
   `run update --phase` (step 9), and handing it to review (step 11);
   and before every PR open (step 10).
   Wave ordering (step 7) applies it too, so a claimed item never reaches a
   dispatch in the first place.
   Checking once at the top of the run is not checking: the human intervenes
   WHILE you work, and a boundary you crossed without looking is an
   intervention you overrode.

   - **A claim on the item — its own, or any ancestor's, since claims cover
     the whole subtree — means STAND DOWN on that item.** Clean stand-down,
     exactly:
     start nothing further on it, finish nothing already started on it,
     open no PR for it, and attempt no mutation of it — the CLI would refuse
     you, and a refusal you provoked is noise in a trail a human is about to
     read. Journal the stand-down, then carry the run on with the other
     items; a claim on one item never ends the run.

         nahel log note --item <item-id> \
           --data summary="stood down at checkpoint: claimed by <claimant>" \
           --data checkpoint=<dispatch|phase|pr-open> \
           --data claim=<the claimed item id — this item, or the ancestor covering it>

   - **A paused run means zero further dispatches for it, from the pause
     onward.** Not "one more, it was already decided": the journal must show
     the `run.paused` event followed by no dispatch for that run's item until
     a human resumes it. Resume is the human's act, never yours.

   - **Never kill a worker.** Intervention is state-level:
     no kill, no terminate, no interrupt mid-write, at any boundary.
     A worker already in flight on a claimed item runs to its own
     NATURAL exit — you wait for the dispatch to return, never shorten it.

     Then YOU journal what it did, because it no longer can. The claim froze
     that run against agent mutations, so the worker cannot close its own run
     record and `nahel run end` on it is refused. Do not force it: the claimed
     run stays `paused` and claimed rather than force-ended, and that
     preserved state IS the evidence that nothing was killed. Journaling
     stays open to you — notes are claim-exempt, because a note mutates no
     record — so an event naming the item and tied to the claimed run lands:

         nahel log note --item <item-id> --run <run-id> \
           --data summary="worker exited naturally under claim: <how it ended>" \
           --data exit=<the worker's exit code> \
           --data claim=<the claimed item id> \
           --data output=<the worker's final output, recorded then abandoned>

     Then abandon that output: it is recorded for the human who claimed the
     item, never merged, never built on. (If a future CLI ever refuses notes
     on claimed items, journal the same event on your own session — drop
     `--item` and `--run`, name the item inside the payload — rather than
     losing the trail.)

   - **Handback resumes from state alone.** The human's `nahel handback`
     clears the claim and journals `item.handback` carrying deterministic
     evidence of what they changed: the commits since the claim baseline, the
     diff summary baseline→HEAD, and the dirty state. So a session with
     NO memory of the claim — a different runner, a later day — continues
     correctly by reading:

         nahel progress --item <item-id>
         nahel log note --item <item-id> \
           --data summary="resumed after handback: <what the human changed, read from the handback evidence>" \
           --data handback=<the item.handback event id>

     Re-read before you re-dispatch: the human's edit may have already done
     the work, changed its shape, or made it wrong. The next dispatch's task
     text states what you read, not what you remember.

4. Discover scope. Resolve the kickoff line against recorded state, never
   against your assumptions:

       nahel brief
       nahel status

   Read the constitution extract the brief renders (binding), the backlog it
   lists, and the recent journal. Then:

   - Map the line onto EXISTING items wherever they already cover it —
     a duplicate backlog item is scope discovery failing.
   - Create what is genuinely missing, through the CLI:

         nahel item new <type> <slug> <lane>

   - Journal what the line resolved to, and what you deliberately left out:

         nahel log note --data summary="scope: <kickoff line> resolves to <ids/slugs>; excluded <what> because <why>"

   - Work that contradicts the constitution is out of scope at any size: park
     it (step 12) instead of building it.

5. Pick a lane per item and journal the reason — the reason is the deliverable
   here, not the label:

       nahel item update <item-id> --lane <direct|epic-lite|full>
       nahel log note --item <item-id> --data summary="lane <lane>: <why this lane, and why not the one below it>"

   The heuristics are prd-parse's, unchanged: `direct` — one focused change,
   no decomposition; `epic-lite` — one coherent feature, a few session-sized
   deliverables; `full` — multi-deliverable or cross-cutting, needing real
   decomposition. Take the lightest lane the work actually fits: ceremony you
   cannot defend in the journal is ceremony you should not have bought. A
   `full` pick goes through step 6 before anything is implemented.

6. Full lane: author the PRD in **AFK authoring mode**, then clear the approval
   gate. prd-new's grilling interview needs a human and you must not ask one —
   so draft from evidence and journal what the interview would have settled.

   a. Own the work through a plan item (prd-new's mechanics):

          nahel item new plan <slug> direct
          nahel item update <plan-id> --status in-progress

   b. Draft `docs/prds/<slug>.md` from project evidence ONLY: the
      constitution, the brief, the backlog, the journal, and the code. Its
      frontmatter carries `name`, `created`, `updated` and NO status field
      (ADR-0013); timestamps come from the system, never estimated:

          date -u +"%Y-%m-%dT%H:%M:%SZ"

   c. Journal EVERY assumption the interview would have resolved — one event
      per assumption, each stating what you assumed and what changes if it is
      wrong:

          nahel log note --item <plan-id> --data summary="assumption: <what you assumed> — <what changes if it is wrong>"

      Keep the event ids. The approval below cites them, and an approval or a
      park with no assumption trail is invalid — the trail is what the
      interview was traded for.

   d. Record the deliverable and hand the item to the gate:

          nahel item update <plan-id> --prd docs/prds/<slug>.md
          nahel item update <plan-id> --status in-review

   e. Resolve the gate by the project's governance, which `nahel brief` shows
      under "governance & merge authority" (a project that declared none reads
      `product: delegated (default)`):

      - **`governance.product: human`** — PARK at the gate (step 12) with the
        assumption trail named in the park reason, and carry the rest of the
        run on. Do not parse, decompose, or implement it: prd-parse refuses an
        unapproved PRD. The human's flip resumes it in a later run.
      - **`governance.product: delegated`** — obtain cross-vendor consensus
        (f), then continue in THIS run.

   f. Delegated approval. Park immediately, without attempting consensus, when
      the recorded inception tier is `seed` — delegated governance demands
      `standard` or above (the tier ratchet).

      i. Bind the proposal to an exact PRD revision:

             git hash-object docs/prds/<slug>.md

      ii. Journal the proposal under YOUR actor, citing the assumption trail:

             nahel log note --item <plan-id> \
               --data summary="PRD proposed for delegated approval: docs/prds/<slug>.md" \
               --data prd=docs/prds/<slug>.md \
               --data revision=<hash> \
               --data assumptions='["<assumption-event-id>", ...]'

      iii. Dispatch the verification to a DIFFERENT vendor — the agent routing
           assigns to `review`. If that route resolves to your own vendor,
           consensus is impossible: park, because a same-vendor self-check is
           not cross-vendor review.

             nahel dispatch review --item <plan-id> -- "Verify docs/prds/<slug>.md at revision <hash>, independently. Read the constitution, the backlog (nahel status), and the assumption events <assumption-event-ids> cited by proposal event <proposal-event-id>. Judge whether the PRD conflicts with the constitution, whether it fits the backlog, and whether each assumption is safe to build on. Then journal your verdict yourself, under your own actor: nahel log note --item <plan-id> --data summary='PRD verification: <agree|disagree> — <the constitution check you performed and what it found>' --data revision=<hash> --data verifies=<proposal-event-id> --data verdict=<agree|disagree>"

           The worker journals its own event under its own `NAHEL_ACTOR`,
           which is what makes the two attributions independent.
           A verification you write yourself proves nothing — one runner's
           note is not a consensus, and the gate treats it as unverified.

      iv. Read the verification back (`nahel progress --item <plan-id>`) and
          PARK on any of: `verdict=disagree` (vendor disagreement), any
          constitution conflict the verification raises, a missing
          verification (the dispatch failed, or the worker journaled nothing),
          or a PRD whose hash moved since the proposal — re-run
          `git hash-object` before deciding, because a revision that changed
          under the verification is unverified.

      v. Record the decision, linking the two events it rests on, then flip the
         plan item under that delegated authority:

             nahel log note --item <plan-id> \
               --data summary="delegated approval (governance.product=delegated): proposed by <your actor>, verified by <verifier actor>" \
               --data revision=<hash> \
               --data proposal=<proposal-event-id> \
               --data verification=<verification-event-id>
             nahel item update <plan-id> --status done

         The delegation covers PLAN-ITEM APPROVAL and nothing else.
         Leaf-item `done` stays human-only (task-lifecycle) — including items
         whose PR merged under `merge: on-approve`.
         Constitution amendments are never delegable, under any governance
         setting.

   g. Continue in the same run: prd-parse (`nahel/workflows/prd-parse.md`)
      creates the feature item from the approved PRD, then epic-decompose
      (`nahel/workflows/epic-decompose.md`) splits it into dependency-ordered
      children. Those children join the wave ordering in step 7.

7. Order the work into waves from the `depends_on` edges — `nahel status`
   renders the tree, `nahel validate` proves the graph is a DAG. Every item
   with no unmet dependency is dispatchable now; run them in parallel only as
   far as you can actually supervise. Apply the checkpoint check (step 3) as
   you order: a claimed item and a paused run are not dispatchable, whatever
   the graph says — drop them from the wave rather than discovering the claim
   at the dispatch itself.

   **COMPLETION-THEN-DISPATCH** — the bar an AFK run may never lower.
   Dispatch an item only after EVERY declared dependency has reached journaled
   agent-reachable completion: its run ended `success` AND its status is
   `in-review` (or `done`, where a human already flipped it). Prove it from
   the journal before dispatching:

       nahel progress --item <dependency-id>

   `done` on its own is NOT the bar: `done` is human-only (task-lifecycle),
   and waiting for it would deadlock a zero-turn run. Dispatch ORDER proves
   nothing either — what proves it is the dependency's completion events
   sitting earlier in the journal than the dependent item's dispatch.

   A dependency whose run ended `failure`, or that sits `blocked`, is not
   complete: park the dependent item (step 12) naming that dependency, and
   move on to what is dispatchable.

8. Dispatch the worker. Run the checkpoint check (step 3) first, then:

       nahel dispatch implementation --item <item-id> -- <the task, stated so a fresh agent can execute it>

   - EVERY worker is spawned this way. Never invoke an agent CLI yourself:
     dispatch resolves the routing map, composes the invocation with the
     worker's own actor identity and the `nahel brief` orientation preamble,
     spawns it, and journals the run. Hand-spawning bypasses routing and
     leaves a worker in the trail that nobody authorized.
   - Route by responsibility, not by preference: `implementation` for the work
     itself, `review` for reviewing it, `architecture` for design judgment. An
     unrouted responsibility falls back to the configured default; with
     neither, dispatch exits non-zero naming the `nahel config set` command
     that fixes it — a setup failure, so park and say so rather than working
     around it.
   - Check the item against the SIGNED constitution before dispatching it, on
     every lane. The Full-lane approval gate (step 6) covers PRDs only, and a
     direct-lane one-liner never passes through it — so this check is where
     the small work gets caught. Work that would contradict the constitution
     parks (step 12); it is never dispatched. Under a hands-off founding the
     signed content is the founding paragraph alone
     (`nahel/workflows/inception.md`): the elaboration below it is unconfirmed
     and can never authorize contradicting it.
   - The task text tells the worker which lane workflow to follow
     (`nahel/workflows/task-lifecycle.md`, or `nahel/workflows/bug-lane.md`
     for a bug) and what "done" means for this item.
   - Dispatch exits 0 only when the worker exited 0; either way the invocation
     and the outcome are journaled. A non-zero worker does not end the run:
     read the item's journal and either re-dispatch with what you learned, or
     park it.

9. Verify by driving, before any PR opens — EVERY lane, no exception, no
    silent skip (hard constraint 6, ADR-0011). An item's worker reporting
    completion (its run ended, its status is `in-review`) is what brings it
    here. This is where an AFK run earns the right to open a PR at all.

    **The invariant is per lane, not per happy path.**
    A `direct`-lane one-liner verifies exactly like a `full`-lane epic.
    The lane scales ceremony — decomposition, PRD authoring, review rounds —
    and never scales this. Least ceremony still drives, or parks. There is no
    lane, and no size of change, whose evidence is "the tests passed".

    Run the checkpoint check (step 3) first: the run you are about to open is
    a phase transition, and `run start` on a claimed item is refused anyway.

    a. Satisfy the run contract on this machine: `nahel doctor` exits 0.

       This is also where gate 1b's deferred proof comes due. A run admitted
       on a journaled first-scaffold obligation (`nahel/workflows/inception.md`,
       "Tier honesty") has by now scaffolded the app that contract describes,
       so the obligation is DISCHARGED here — before any PR opens — and the
       discharge is journaled, not remembered:

           nahel log note --item <item-id> \
             --data summary="first-scaffold obligation discharged: nahel doctor exits 0 on this machine" \
             --data obligation=<the first-scaffold obligation event id>

       Anything other than exit 0 is gate 1b's refusal reaching you late —
       park (e) rather than driving against a contract that does not hold. An
       undischarged obligation blocks the PR rather than being forgiven.
    b. Launch the app with the contract's `launch` command (and `seed` where
       the contract defines one). The app a human would open, actually
       running — not a test harness standing in for it.
    c. Exercise the CHANGED flow end to end with whatever driving tooling the
       host has — browser automation, the app's own CLI, an HTTP client.
       THE CHANGED flow: what this item altered, walked from entry to
       observable outcome, not a neighbouring flow and not a tour of the app.
       Tests passing is not driving; a page that renders is not the flow;
       re-reading the diff is not driving.
    d. Journal the evidence on a run of your own — the worker's dispatch run
       closed when it exited, and evidence tied to no run is evidence tied to
       nothing:

           nahel run start <item-id>
           nahel run update <run-id> --phase verify
           nahel log note --item <item-id> --run <run-id> \
             --data summary="verified by driving: <the steps you drove, in order> — <what you observed at each>" \
             --data flow=<the changed flow, named> \
             --data tooling=<what drove it: browser automation | app CLI | HTTP client | …> \
             --data lane=<direct|epic-lite|full>
           nahel run end <run-id> success

       Fixed keys, so a human audits the trail by grepping it rather than
       reading all of it — the same discipline as step 6's delegated-approval
       record. The event carries the VERIFYING ACTOR (your `NAHEL_ACTOR`) and
       the run ref, so the claim is attributable to someone; the summary
       carries enough specificity to audit WITHOUT re-running anything —
       which flow, which steps, in what order, and what you saw. "Verified the
       feature" is not evidence. Keep the event id: step 10's PR body cites it.

       Drove it and it FAILED? That is a finding, not a park: the item is not
       done. End the verify run `failure`, journal what broke, then either
       re-dispatch (step 8) with what you observed or park it (step 12) —
       never open the PR on a flow you watched fail.

    e. If the host CANNOT drive, PARK the item (step 12) with an actionable
       reason naming which of the three it was:
       - **no driving tooling** on this host — nothing here can exercise the
         flow;
       - a **headless transport** — this run has no way to reach the app;
       - an **incomplete contract env** — `nahel doctor` exit 3 or 4; name the
         unset vars or the failing healthcheck it listed.

           nahel item update <item-id> --status blocked
           nahel log note --item <item-id> \
             --data summary="parked: cannot verify by driving — <which of the three, named> — <what you tried>" \
             --data park=cannot-drive

       A silent skip is the one forbidden outcome. Every item reaching step 10
       carries EITHER journaled driving evidence OR a park — there is no third
       option, and "the change is obviously fine" is not one.

10. Open ONE draft PR per epic, on that epic's branch (`epic/<slug>`, per
    task-lifecycle's git discipline). Run the checkpoint check (step 3) first.
    A run that touched two epics opens two PRs — never one combined PR,
    however convenient the diff.

        gh pr create --draft --title "<epic>: <what it delivers>" --body-file <file>

    The body carries the run trail, so the PR is auditable without the
    journal: the kickoff line; the waves and their order; each item's lane and
    why; the verify-by-driving evidence from step 9 — quoted, citing its
    journal event ids and the verifying actor, for every item it carries;
    every waiver in force (repro waivers —
    `nahel brief` surfaces them) stated plainly; and every park with its
    reason.

    The one part of the trail this step does NOT write is the
    review dispositions, because no review has run yet — and a round faked
    into that list is a review that never happened.
    The review loop (step 11) appends them to this body as it goes, round by
    round, through `gh pr edit`. That append-per-round shape is the trail
    PRs #13–#18 proved out, and it is why the PR opens BEFORE the review: the
    loop annotates and merges an existing PR, it does not create one.

    An item that parked at step 9 is not PR-bound, and an epic whose changed
    flow was never driven does not get a PR at all — its park stands in the
    PR's place until a host that can drive picks it up.

    Merging is not this workflow's act. Under `merge: human` the PR waits for
    the human; under a validly activated `merge: on-approve` the review loop
    may merge on sign-off. Either way the invariant here is one trail-carrying
    PR per epic.

    With the PR open, decide whether the surface it changes earns a QA sweep
    once it merges. Under the default `merge: human` this run ends BEFORE the
    merge, so "after the merge, sweep" cannot be a live step here — the
    schedule has to outlive the run, and the only durable carrier is an item.
    So you MAY file one: a `qa` item whose slug NAME states what to sweep and
    which PR it waits on (item names are slugs — spaces are refused).

        nahel item new qa sweep-<surface>-after-pr-<n> direct \
          --depends-on <item-id>

    It starts in `backlog` and nothing runs now. Under `merge: human` a
    later runner or kickoff picks it up once the human's merge lands; under a
    validly activated `merge: on-approve` the same runner may pick it up after
    its own auto-merge. PICKUP RULE, stated here because `--depends-on` cannot
    carry it: a dependency is satisfied when the feature item finishes review,
    which happens BEFORE any merge — so whoever picks the scheduled item up
    must first verify the named PR actually MERGED (`gh pr view <n> --json
    state`) and journal that check in the pickup note; an unmerged PR parks
    the sweep, never starts it. Either way the lane that runs it is
    `nahel/workflows/qa-lane.md`, and the `--depends-on` keeps the sweep
    behind the feature item it sweeps.

    This is a judgment call, and it is journaled EITHER WAY — a "no" that
    leaves no trace is indistinguishable from having forgotten:

        nahel log note --item <item-id> \
          --data summary="qa scheduled: <surface> after PR #<n> — <qa-item-id>" \
          --data qa=<scheduled|not-scheduled>

        nahel log note --item <item-id> \
          --data summary="qa not scheduled: <surface> — <the reason it is not worth a sweep>" \
          --data qa=<scheduled|not-scheduled>

    QA never blocks a PR from opening —
    verify-by-driving remains the pre-PR bar (step 9), and the QA lane is
    broader and slower and runs after. A sweep decided against is a schedule
    not filed, never a PR held open.

11. Review. The draft PR from step 10 is what gets reviewed: run the
    checkpoint check (step 3) — handing an item to review is a phase
    transition on it — then invoke the review loop —
    `nahel/workflows/review-loop.md` — on that epic's PR-bound work. That
    workflow owns the reviewing: two independent cross-vendor reviewers,
    findings validated against HEAD, red-first fixes, the iteration cap, the
    per-round `gh pr edit` that writes each round into the PR body, and ALL
    merge mechanics including merge authority. Do not restate its rules here,
    and do not merge anything yourself.

    Yours is the timing only: review when a coherent slice is complete — not
    per commit, not once at the very end — and stop when the loop signs off or
    parks. A cap-reached park is the loop's decision: honor it, and keep the
    rest of the run moving.

12. Park anything you are not authorized to decide — this is how an AFK run
    ends a question without asking one:

        nahel item update <item-id> --status blocked
        nahel log note --item <item-id> --data summary="parked: <what is needed, why the run cannot decide it, and what you already tried>"

    Both halves are required. `blocked` is what makes the park visible —
    `nahel brief` lists blocked items under "pending human decisions", so the
    next session sees it without reading the journal — and the reason is what
    makes it actionable. A park with no reason is a dead end; a reason with no
    `blocked` status is invisible.

    Park, never ask, on: a `governance.product: human` approval gate; vendor
    disagreement, a constitution conflict, or a `seed` tier under delegated
    approval; a dependency that failed or is blocked; a host that cannot
    drive; a review loop at its cap; a claim standing over the work; a missing
    route or an unusable run contract; and anything that would contradict the
    constitution.

13. Stop when nothing is dispatchable — every discovered item is `in-review`,
    `done`, parked, or claimed — and close the run honestly:

        nahel log note --data summary="afk-run complete: <PRs opened>, <items parked and why>, <what a next run should pick up>"

    Then say the same thing to whoever reads the session. The proof of a good
    run is that a fresh session with no memory can reconstruct it from
    `nahel brief` and `nahel progress` alone.

Fallback (degraded environment): if the `nahel` CLI is unavailable, do NOT run
AFK. The autonomy gate cannot be checked, no worker can be dispatched under
routing, and no park can be recorded — an AFK run without the CLI is an
unrecorded run. Report the kickoff line, the scope you would have discovered,
and that the run is blocked on the CLI; make no state mutations until it is
back. If the host cannot drive the app, step 9 already covers it: the
affected items park rather than the run continuing blind. If no PR tooling is
available, stop before step 10 with the branch pushed and say the PR is
pending — the review loop needs that PR too, so step 11 does not run either — an epic without its trail-carrying PR is unfinished work, not a
delivered run.
