---
name: prototype-lane
description: Explore an open question with N parallel throwaway variants — ceremony stripped, code that never merges, and a promotion path that carries only the winning approach
args: "<item-id>"
---

# Workflow: prototype-lane

Load and follow this workflow to work a `prototype` item. A prototype exists to
answer a question — "which of these approaches actually works?" — as fast as
honest exploration allows. Everything in this lane follows from two rules:

1. **Ceremony is stripped.** No TDD, no review loop, no consensus, no
   decomposition. The throwaway only has to run well enough to answer the
   question. Buying ceremony here buys nothing: the code is going in the bin.
2. **Prototype code never merges.** Not by a PR, not by a push, not by a
   cherry-pick, not "just this one file". Only the winning *approach* graduates,
   through the plan lane, and the feature lane rebuilds the work properly.

The second rule is enforced by mechanism, not by your good intentions — see
step 3. The lifecycle mechanics this lane does share with the rest (the run,
journaled findings, the claim rule) are `nahel/workflows/task-lifecycle.md`'s;
follow it alongside this one. Every state change is a CLI call; never hand-edit
anything under `nahel/`.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

## 1. Variants — spawn the workspaces

Open (or create) the prototype item, then spawn the variants in one call:

    nahel item new prototype <slug> direct
    nahel prototype start <item-id> --variants <n> \
      --approach "<approach for variant 1>" \
      --approach "<approach for variant 2>"

Pass one `--approach` per variant, in order — an approach you do not state is
an approach nobody can judge later. Omit them only when the exploring agent is
about to write them into the mini-PRDs itself; the CLI seeds a TODO in their
place. Two or three variants is the normal shape: variants are for genuinely
different framings, not for parameter sweeps.

What the CLI creates, per variant, deterministically:

- a branch `prototype/<slug>/variant-<n>` — the name is not cosmetic; it is
  what never-merge enforcement recognizes;
- a git worktree beside the repo (`--worktree-dir` moves it), checked out on
  that branch — never inside the repo, which the CLI refuses: a prototype
  worktree there would sit one `git add -A` from the merge this lane forbids;
- a mini-PRD at `docs/prototypes/<slug>/variant-<n>.md`, seeded in both the
  worktree and the main tree — the worktree copy is the working brief, the
  main-tree copy is the durable record that outlives the throwaway;
- a `prototype` work item, `direct` lane, in-progress, owning that variant and
  recording its mini-PRD;
- one journaled creation record carrying each branch's base commit. That base
  is what lets `nahel validate` tell a fresh branch apart from a merged one, so
  never create prototype branches by hand.

Commit the main-tree mini-PRDs to the default branch (they are ordinary
knowledge documents, and nahel state commits go straight to the default branch
per task-lifecycle's git discipline). Nothing else from a variant ever lands
there.

## 2. Explore — build the throwaway

Work each variant inside its own worktree, under its own item. Before writing
code, finish the mini-PRD: the approach in one paragraph, the question this
variant answers, and — decided **before** you build — what result would make it
the winner and what result would kill it. A prototype judged after the fact just
ratifies whatever got built.

Then build the smallest running thing that answers the question. Explicitly:
**no TDD** (no red-first requirement, no coverage bar), **no review loop**
(`nahel/workflows/review-loop.md` is not invoked here), **no consensus**, no
epic decomposition. Journal what you learn as you go — the findings are the only
durable output of this lane:

    nahel log note --item <variant-item-id> --data summary="<what this variant showed>"

Variants may run in parallel; they touch different worktrees and different
items, so they never contend.

## 3. The never-merge invariant, and how it is enforced

Prototype code never merges. Three mechanisms hold the line, and none of them is
this paragraph:

- **The CLI refuses a merge-bound state.** `nahel item update <id> --status
  in-review` or `--status done` on a `prototype` item is refused: `in-review`
  means a PR, `done` means it landed, and neither is available to code that
  never merges. The refusal is journaled as `prototype.merge-refused`, so the
  attempt is auditable. A prototype item's terminal state is `dropped`.
- **`nahel validate` flags a prototype ref that got out.** `prototype.merged`
  (error) fires on either of two signals: *ancestry* — the branch has commits
  past its recorded base and the default branch now contains them — or *patch
  equivalence* — `git cherry` reports commits of the branch whose patch is
  already in the default branch. The second exists because a cherry-pick lands
  the code as a NEW commit, which ancestry cannot see at all; it names the
  copied commits in the finding. `prototype.pushed` (error) fires on any
  remote-tracking prototype ref — pushing is the precondition for a PR, and it
  is as far as an offline, deterministic check can see. A prototype branch nahel
  has no creation record for is reported as `prototype.unrecorded` (warning):
  unjudgeable, not innocent. And when the ref scan itself cannot complete inside
  a repo that demonstrably exists — output over the capture cap, broken refs,
  a probe git refuses to answer — `prototype.scan-failed` (error) reports the
  aborted scan rather than letting a skipped check read as verified-clean.
- **Merge-base drift.** `validate` also compares each variant's merge-base
  with the default branch against its recorded creation base. An honest
  variant's divergence point never moves; it drifts only when history crosses
  the fence in either direction — a prototype commit merged into the default
  branch (even if the branch then advanced past it), or the default branch
  merged into the variant. Both directions are forbidden: **never merge the
  default branch into a variant — a stale variant is disposed and re-started,
  never refreshed.**
- **The blind spot, stated plainly.** A squash merge — or a copy someone edited
  on the way in — rewrites the patch, so none of the signals above sees it, and
  no offline check at a sane cost would. The mechanical teeth are ancestry,
  patch equivalence, and merge-base drift; there is no fourth check pretending
  to more.
- **You.** **Never open a PR from a prototype branch, and never push one.**
  That rule is not a formality riding on top of the checks — it is what covers
  the case the checks cannot see, which is exactly why it is absolute. The two
  checks catch a footprint; they are a net, not permission to test the net.

If a prototype ref does reach the default branch, revert it out. Then promote
the approach properly, below.

## 4. Judge

When the variants have answered the question, judge them against the criteria
their mini-PRDs committed to in step 2. Record the judgment as an observation on
the parent prototype item, citing the journal events the variants produced:

    nahel observe prototype-verdict-<slug> --item <item-id> \
      --data body="<which approach won, and the evidence that decided it>" \
      --data sources='["<journal-event-id>", ...]'

Under `governance.product: human` the judgment is the human's to make — park it
(`nahel/workflows/afk-run.md` step 12) rather than deciding for them.

## 5. Promote the winner

Promotion carries the winning **mini-PRD**, never the winning code:

    nahel prototype promote <variant-item-id>

That opens a `plan` item on the `full` lane, whose body names the mini-PRD and
the prototype branch as **reference-only**. From there the ordinary product
path, unchanged:

1. Author the full PRD from the mini-PRD per `nahel/workflows/prd-new.md`, and
   record it: `nahel item update <plan-id> --prd docs/prds/<slug>.md`.
2. Clear the approval gate per the project's `governance.product` — delegated
   cross-vendor consensus, or the human flip under `governance: human`. Same
   gate, same rules, same park triggers as every other PRD approval:
   `nahel/workflows/afk-run.md` step 6. The approval is journaled and never
   skipped.
3. Parse the approved PRD into the feature lane with
   `nahel/workflows/prd-parse.md`, which refuses an unapproved PRD.

**Never copy code off the prototype branch** into the promoted work — not a
file, not a diff, not a "just the tricky function". Read it, learn from it,
rebuild it in the feature lane with the ceremony the feature lane demands. The
prototype code must be verifiably absent from the promoted feature's diff.

### The tier ratchet

Promotion is one of the two acts the inception tier ratchet guards. On a project
whose recorded inception tier is `seed` — or which records no tier at all — the
promotion is **refused**, and the refusal is journaled naming the fix:
**upgrade inception first**.
Re-run `nahel/workflows/inception.md` at `standard` (or above) and
record the new tier with `nahel config set inception`, carrying the constitution
signature through in that same command. Then promote. The bar is `standard`;
the ratchet only ever moves the tier up.

## 6. Dispose of every variant

Every variant is disposed of — the losers, and the winner once its approach has
been promoted and parsed. Disposal removes the worktree, drops the item, and
journals why:

    nahel prototype dispose <variant-item-id> --reason "<why this one lost>"

The branch deliberately survives as the reference-only record; only the
workspace goes. A variant with uncommitted work is refused — commit it on its
own branch, or pass `--force` to dispose of it anyway. Losing variants without a
journaled disposal are how a prototype lane quietly turns into abandoned
branches nobody dares delete.

Fallback (degraded environment): if the `nahel` CLI is unavailable, exploration
may proceed — worktrees, code, and mini-PRD prose are all ordinary git and
files — but make **NO** item, status, journal, or observation mutations, and do
**NOT** create prototype branches by hand: a branch with no journaled base is a
branch nahel cannot clear of never-merge violations. Report which mutations are
pending so a CLI-equipped session can record them. The invariant does not
degrade with the tooling: prototype code never merges, whatever is or is not
available to enforce it.
