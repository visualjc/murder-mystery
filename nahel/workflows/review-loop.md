---
name: review-loop
description: Review a PR to sign-off — two cross-vendor reviewers, findings validated against HEAD, red-first fixes capped at three rounds, then the merge decision
args: "<item-id>"
---

# Workflow: review-loop

Load and follow this workflow to take one item's PR-bound work from "the work
is done" to signed off: two independent cross-vendor reviewers, every finding
validated against HEAD before it may be fixed, accepted findings fixed
red-first, at most three rounds — and then the merge decision. The loop runs
on an OPEN PR: its rounds annotate that PR's body and its merge decision acts
on it, so the PR exists before the loop starts. This document owns ALL merge
mechanics; `nahel/workflows/afk-run.md` invokes it (its step 11, after the
draft PR its step 10 opens) and deliberately does not restate any of them.
Whoever drives the loop, the rule is the same: reviewing is not merging, and
merging is not yours unless the recorded authority says it is.

Every step below is a shell command or a paragraph of judgment, so the loop is
drivable by pure conversation — no host-agent feature is required and nothing
here is specific to one vendor's tooling.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.
That id is also your VENDOR identity: the cross-vendor rule in step 1 compares
it against the agent a route names.

Never hand-edit anything under `nahel/` — every state change below is a CLI
call. The claim rule holds here too (`nahel/workflows/task-lifecycle.md`): a
mutation refused because a claim covers the item is the human's word that this
work is theirs. Stand down and journal the stand-down; never review, fix, or
merge around a claim.

1. Resolve the two reviewer slots — cross-vendor, or nothing. Both are named
   by the committed routing map, and neither is a preference of yours:

       nahel brief

   - **Slot 1 — the review route.** `routing.review`, resolved exactly as
     dispatch resolves it: the responsibility route first, then
     `routing.default`. This reviewer is SPAWNED (step 3a), so its findings
     and its verdict land under its own actor.
   - **Slot 2 — the second reviewer.** `routing.review2` when the map sets it:
     an optional `{agent, model}` entry naming this slot's vendor outright, so
     the pairing is checkable from committed state — `nahel validate` warns
     (`routing.review-same-vendor`) when both slots land on one vendor, before
     a run discovers it the expensive way. It is a routing KEY,
     not a fourth responsibility: the ADR-0015 enum still carries one
     `review`, and
     `nahel dispatch review2` is refused. The slot is dispatched THROUGH the
     review responsibility instead, on its own chain — `--slot 2`.

     With `routing.review2` unset — every map written before it existed — slot
     2 falls back to the OTHER vendor the same map already names for this
     work: `routing.implementation`, then `routing.default`. Same bar,
     resolved down the same chain `--slot 2` walks.

     **Who fills slot 2 depends on who is driving, and it is mechanical.**
     Compare your own actor's vendor against the agent the slot resolved to:

     - **your vendor IS the slot's agent** — review it yourself, in-session,
       under your own actor (step 3b). Today's path, unchanged.
     - **anything else** — DISPATCH it, so the verdict lands under the
       vendor the slot actually names:

           nahel dispatch review --slot 2 --item <item-id> -- <the slot-2 review task, exactly as in step 3a>

       The dispatched worker journals its own findings and verdict under its
       own actor, which is what makes slot 2 independent of you.

     A driver whose vendor the slot does not name is therefore no longer a park
     — any capable host can drive this loop, which is the whole point of
     agent-neutrality. Park only when the slot resolves to NOTHING (dispatch
     refuses, naming the config fix) or to slot 1's vendor.

   Then compare the two VENDORS — the agent ids, not the models:

   - The same id — including the fall-through case where `routing.review` is
     unset and both slots resolve to `routing.default` — means this project
     has ONE vendor, not two.
     REFUSE: two same-vendor reviews are not two reviewers, and no number of
     them satisfies the bar. Park (step 11) naming the routing fix
     (`nahel/workflows/setup-routing.md`), and sign nothing off.
   - A driving vendor the map names nowhere is an unrouted reviewer: slot 2 is
     then named by no config at all, which is the same refusal.

   A single-vendor project cannot run this loop. That is a setup fact to fix,
   never a bar to lower.

2. Open the round, bound to one revision. A finding is only judgeable against
   something exact, so record what "current" meant when the round started:

       git rev-parse HEAD
       nahel run start <item-id>
       nahel run update <run-id> --phase review
       nahel log note --item <item-id> --run <run-id> \
         --data summary="review round <n> of 3 opened at HEAD <sha>" \
         --data round=<n> --data head=<sha>

   `run start` prints the run id; the steps below carry it. Rounds are counted
   per item, and the count survives sessions because it is journaled — read it
   back rather than trusting memory:

       nahel progress --item <item-id>

3. Review — both slots, independently, against the SAME revision.

   a. Slot 1, dispatched. Dispatch is what makes the verdict independent: the
      worker runs under its own `NAHEL_ACTOR`, so its findings are attributed
      to its vendor rather than to yours.

          nahel dispatch review --item <item-id> -- "Review the PR for <item-id> at HEAD <sha>, independently and adversarially. Read the diff (git diff <base>..<sha>), the item and its backlog context (nahel status), the constitution the brief renders, and the tests the change touches. Journal EACH finding yourself, under your own actor: nahel log note --item <item-id> --data summary='review finding: <path>:<line> — <what is wrong and why it matters>' --data head=<sha> --data round=<n> --data severity=<blocker|major|minor|nit>. Then journal exactly one verdict: nahel log note --item <item-id> --data summary='review verdict: <approve|request-changes> — <the reasoning in one line>' --data head=<sha> --data round=<n> --data verdict=<approve|request-changes>"

      A findings list you write on a reviewer's behalf is your own review
      wearing its name — the loop counts it as one reviewer, not two.

   b. Slot 2. Dispatched (step 1) when the slot names a vendor other than
      yours — same task text as (a), and the worker journals its own findings
      and verdict. Otherwise yourself, under your own actor — and do it
      BEFORE you read slot 1's findings. Reading them first turns an
      independent review into a confirmation of someone else's:

          nahel log note --item <item-id> --run <run-id> \
            --data summary="review finding: <path>:<line> — <what is wrong and why it matters>" \
            --data head=<sha> --data round=<n> --data severity=<blocker|major|minor|nit>
          nahel log note --item <item-id> --run <run-id> \
            --data summary="review verdict: <approve|request-changes> — <the reasoning in one line>" \
            --data head=<sha> --data round=<n> --data verdict=<approve|request-changes>

      Review from the diff and from the code at HEAD, never from your memory
      of writing it: a recollection is not a review.

   c. A slot that journaled nothing has not reviewed. Re-dispatch it once with
      what you learned; if it still journals nothing, park (step 11) — a loop
      that proceeds on one list of findings has quietly become single-vendor.

4. Validate EVERY finding against current HEAD before anything is fixed — the
   dispatched reviewer's findings and your own alike. A reviewer reads one
   revision; the branch may have moved under it:

       git rev-parse HEAD
       git show <sha>:<path>
       git diff <sha>..HEAD -- <path>

   Re-read each finding's cited code AT HEAD and decide:

   - The cited code exists at HEAD and the defect is still present → LIVE; it
     goes to reconciliation (step 5).
   - The cited code no longer exists at HEAD, or the defect it names is
     already gone → STALE. Dismiss it with a journaled note and fix nothing:

         nahel log note --item <item-id> --run <run-id> \
           --data summary="finding dismissed as stale: <the finding> — cited <path>:<line> as of <sha>, no longer exists at HEAD <head-sha>" \
           --data finding=<finding-event-id> --data disposition=dismissed-stale --data head=<head-sha>

   Never fix a finding blind. "Fixing" a stale finding edits code no reviewer
   objected to, and the trail then shows a change nobody asked for. Where the
   validation is genuinely ambiguous — the code moved and the defect may have
   moved with it — treat the finding as LIVE and say so in its disposition:
   the cheap error is re-examining a real defect, not shipping a dismissed one.

5. Reconcile both reviewers into ONE disposition list. Every finding gets
   exactly one disposition, every disposition is journaled with its reason,
   and that single list — not the two lists — is what the fixes and the PR
   body are driven from:

   - **accepted** — a live defect; it gets fixed (step 6).
   - **dismissed-stale** — already journaled in step 4.
   - **dismissed-disagreed** — live, but wrong on the merits. Journal the
     ARGUMENT, not the verdict:

         nahel log note --item <item-id> --run <run-id> \
           --data summary="finding dismissed on the merits: <the finding> — <why it is wrong, with the evidence>" \
           --data finding=<finding-event-id> --data disposition=dismissed-disagreed

   - **deferred** — real, but outside this PR's scope. It becomes a work item
     (`nahel item new <type> <slug> <lane>`) whose id the disposition names —
     never a promise in prose.

   The same finding raised by both reviewers reconciles into one entry citing
   both events. A reviewer that raises a finding AGAIN in a later round after
   you dismissed it has objected: escalate it to accepted, or carry it to the
   cap (step 8). You may never dismiss the same finding twice.

6. Fix the accepted findings, red-first where testable. For each one:

       nahel run update <run-id> --phase red
       # write the failing test that demonstrates the finding
       nahel run update <run-id> --phase green
       # make it pass

   A finding no test can express (prose, naming, a doc line) is fixed directly
   and journaled as such — but "not testable" is a claim you must be able to
   defend, and a defect a test COULD express is fixed red-first, never
   green-only. Never weaken an existing assertion to make a fix land.

   Journal the fix against the finding, so a reader can walk finding → fix:

       nahel log note --item <item-id> --run <run-id> \
         --data summary="finding fixed: <the finding> — <what changed, and the test that now covers it>" \
         --data finding=<finding-event-id> --data disposition=accepted

7. Re-review after the fixes, and count the round. Push the fixes, then run
   steps 2–6 again on the NEW HEAD with BOTH slots reviewing again: a
   re-review of a revision nobody re-read is not a re-review, and a second
   round that only re-runs slot 1 has dropped to one vendor.

   The cap is THREE rounds per item. It is a cap on the loop, not on your
   patience: a third round that ends unresolved does not buy a fourth, and
   neither does a finding that looks nearly fixed.

8. Sign off — or park at the cap.

   Sign-off requires ALL of: both slots' latest verdict is `approve`, both
   verdicts stand at the SAME HEAD, and every finding carries a journaled
   disposition. Anything less is not sign-off, however close it feels:

       nahel log note --item <item-id> --run <run-id> \
         --data summary="review signed off at HEAD <sha> after <n> round(s): <accepted/dismissed/deferred counts>, both slots approve" \
         --data head=<sha> --data rounds=<n>
       nahel run end <run-id> success

   The cap reached with anything unresolved — an open blocker, a reviewer
   still requesting changes, a finding that keeps regressing — parks the item
   for a human, with the loop history journaled:

       nahel run end <run-id> failure
       nahel item update <item-id> --status blocked
       nahel log note --item <item-id> \
         --data summary="parked: review loop reached its 3-round cap — round by round: <findings, dispositions, verdicts>; still contested: <what and by which slot>"

   Never merge over objections: an unresolved blocker is exactly what the cap
   exists to surface, and merging it would trade a human's decision for a
   deadline. And never let a cap-reached park stall the rest of the run — the
   park IS this item's ending; the caller honors it and keeps its other items
   moving.

9. The merge decision — authority FIRST, approvals second. Read the authority
   actually in force from the brief's "governance & merge authority" section,
   never from the config file's text and never from an approval count:

       nahel brief

   Before either branch below, re-read HEAD. Step 8 required both verdicts to
   stand at the SAME HEAD; this requires that HEAD to still be the CURRENT
   one at the moment of the decision — a push landing in between (a
   co-driver, a rebase, your own late fix) means the commits about to merge
   are not the commits anyone reviewed:

       git rev-parse HEAD

   Differs from the sign-off HEAD? The sign-off is STALE — do not merge, and
   do not re-sign it from memory: journal the staleness and run another round
   (step 2) on the new HEAD, both slots reviewing again —

       nahel log note --item <item-id> --run <run-id> \
         --data summary="sign-off stale at merge: signed off at HEAD <sign-off-sha>, HEAD is now <current-sha> — no merge; re-reviewing" \
         --data head=<current-sha> --data signed_off_at=<sign-off-sha>

   — or, if that would exceed the three-round cap, park it (step 11) naming
   the moved HEAD. A stale sign-off buys no extra round; the cap is the cap.

   - **`merge: human`** — the default, and what an absent `merge` section
     means. The PR waits for a person: refuse to merge it
     regardless of how many approvals it carries. A signed-off PR under
     `merge: human` is a finished review, not a merge authorization. Park the
     merge decision (step 11) so the brief lists it under pending human
     decisions, and say in the reason that the work is approved and waiting.

   - **`merge: on-approve`, rendered live** (no `inert` marker) — the human's
     committed config flip IS their standing authorization, so reviewer
     sign-off merges:

         gh pr ready <pr>
         gh pr merge <pr> --squash

     Then journal WHO authorized it — all three attributions, or the trail
     does not show the merge was authorized:

         nahel log note --item <item-id> \
           --data summary="merged under merge: on-approve — authorized by <human actor> (config act <event-id>), signed off by <slot-1 vendor> and <slot-2 vendor>" \
           --data authorized_by=<event-id> \
           --data verdicts='["<slot-1-verdict-event>", "<slot-2-verdict-event>"]'

   - **`merge: on-approve`, rendered `inert`** — `inert — agent-set by
     agent:<id>` (an agent cannot grant the human's standing authorization),
     `inert — no journaled config mutation sets it` (unprovable provenance is
     not authorization), or setters tied in the same second that disagree. In
     every case the brief also prints the authority in force, and it is
     `merge: human`: behave as `merge: human` exactly, park the merge decision,
     and expect `nahel validate` to carry the `merge.unauthorized` warning
     naming the fix. Do NOT "help" by setting the flag yourself — an agent
     setting it is the very defect being warned about.

   Guidance to carry wherever this flag is discussed, and to repeat when a
   setup workflow writes it — use `merge: on-approve`
   SPARINGLY — small items, or changes QA testing covers well;
   `merge: human` stays the default everywhere.

   Leaf-item `done` stays human-only (task-lifecycle), explicitly including an
   item whose PR merged under `merge: on-approve`. Merging is a repository
   act; accepting the work is the human's.

10. Write the trail into the PR body, every round, before you stop. The
    journal is the record of last resort; the PR is where a human reads the
    same story without a clone:

        gh pr edit <pr> --body-file <file>

    Per round the body carries: the HEAD reviewed, each reviewer's findings
    under its own vendor, the reconciled disposition of every finding (stale
    dismissals and on-the-merits dismissals stated as such), the fixes with
    the tests that now cover them, and both verdicts. Then the outcome:
    sign-off with its round count, or the cap park with what remains
    contested — and the merge decision with the authority it rested on. Post
    each disposition as a reply to its finding where the host's PR tooling
    supports it; the reviewer that raised a finding should be able to see what
    became of it.

    This is the trail `nahel/workflows/afk-run.md` expects the PR body to
    carry: its step 10 opens the PR with the run trail up to that point, and
    each round here APPENDS to that body rather than replacing the run's own
    account — rounds, findings, dispositions, and verdicts.

11. Park anything you are not authorized to decide — the way this loop ends a
    question without asking one:

        nahel item update <item-id> --status blocked
        nahel log note --item <item-id> \
          --data summary="parked: <what is needed, why the loop cannot decide it, and what you already tried>"

    Both halves are required: `blocked` is what makes the park visible under
    the brief's pending human decisions, and the reason is what makes it
    actionable.

    Park, never ask, on: both reviewer slots resolving to one vendor; a slot 2
    chain no routing key answers (dispatch refuses it, naming the config fix);
    a slot that will not review; the three-round cap with anything unresolved;
    a sign-off gone stale at the merge decision with the cap already spent; a
    merge under `merge: human`; a `merge: on-approve` the brief marks inert;
    and a claim standing over the item.

Fallback (degraded environment): if the `nahel` CLI is unavailable, do NOT run
the loop — the second reviewer cannot be spawned under routing, no verdict can
be attributed to a vendor, and no park can be recorded, so an unrecorded
review is all that would be left. Report what you would have reviewed and that
the loop is blocked on the CLI, and make no state mutations until it is back.
If the PR tooling is unavailable, review and journal exactly as above, then
stop before step 9 and say the merge decision is pending — never merge by
pushing to the default branch. If only one vendor is reachable on this
machine, step 1's refusal already governs: the loop does not run, and the PR
waits for a human reviewer.
