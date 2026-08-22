---
name: qa-lane
description: Run a QA pass on a target project — charter the plan from the criteria the project already records, then sweep, file, and ratchet what the sweep finds
args: "<target hint or item id>"
---

# Workflow: qa-lane

Load and follow this workflow to run a QA pass over a target project. QA here
is what a human QA engineer does: decide what to check, drive the real running
app, file what turns up as proper work items, and leave behind scripts so the
same ground never has to be walked by hand twice.

The lane is **target-agnostic**. Everything it checks is derived from what the
target project itself records — its PRDs, its constitution, its open bugs, its
knowledge documents — so the same procedure works on a project you have never
seen before. You are testing the target's app; nothing outside the target repo
is evidence about it, and nothing you already believe about the app counts as
a result.

**QA finds; QA never fixes.** A defect this lane discovers leaves as a bug
item carrying a repro, not as a patch — a sweep that fixes what it found has
skipped a diagnosis and hidden its own evidence. And **QA never gates a merge**:
findings inform, and merge authority stays the target's own
(`nahel/workflows/review-loop.md`).

The lifecycle mechanics — status flips, the run, journaled findings, the claim
rule — are `nahel/workflows/task-lifecycle.md`'s; follow it alongside this
one. Every state change is a CLI call; never hand-edit anything under
`nahel/`.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

## 1. Own the work

A QA pass is a work item like any other, and it carries a run — an unjournaled
sweep is a sweep nobody can audit.

Resolve the argument first. An item id names an existing `qa` item: open it
(`nahel status`) rather than creating a twin. A target hint — "sweep the
checkout flow" — creates one:

    nahel item new qa <target-slug>-sweep direct
    nahel item update <item-id> --status in-progress
    nahel run start <item-id>
    nahel run update <run-id> --phase charter

Then journal what the hint resolved to, so the charter's scope is auditable
against what was actually asked:

    nahel log note --item <item-id> --run <run-id> \
      --data summary="qa scope: <the hint, verbatim> resolves to <surfaces in scope>; excluded <what> because <why>"

Run every command from the TARGET repo's root. Its store holds the criteria
you charter from, and its journal is where this run belongs.

## 2. Charter — the test plan comes from recorded criteria

You do not invent a test plan. You DERIVE it from what the target already
records, so every case traces to something the project committed to and a
human can check the plan against the promises rather than against your taste.

Read the three sources, in this order.

a. **Recorded acceptance criteria.** `nahel status` lists the items, and an
   item carrying a PRD renders `prd=docs/prds/<slug>.md`. Read the PRD of
   every feature in scope and lift its acceptance criteria: each criterion of
   a feature in scope earns at least one case.

       nahel status
       nahel brief

b. **The constitution's hard constraints.** `nahel brief` renders the
   constitution extract, and its hard constraints bind the app. Classify each
   one (below); every DRIVEABLE constraint earns at least one case.

c. **Open bug items.** Every open `bug` item is a regression check — the
   defect a project already knows about is the one most likely to come back.
   A bug carrying `investigation=docs/investigations/<id>.md` already has its
   repro written down: lift it into the case rather than rediscovering it.

**Brownfield fallback.** A target that records no PRDs charters from the
knowledge layer instead — `PRODUCT.md` and `CONTEXT.md`, which `nahel brief`
points at — plus the app's visible surfaces, walked once before the charter is
written. Such a charter must LABEL this basis in its Purpose section
("chartered from knowledge documents and observed surfaces: this project
records no PRDs"), because a reader has to know the plan rests on inference.
Never present an inferred case as a traced one.

### Driveable, or a process rule — classify, never game

Not every recorded rule is checkable by driving an app, and a charter that
quietly drops the awkward ones is a charter grading itself. Classify EVERY
hard constraint, and carry the classification into the charter:

- **DRIVEABLE** — the constraint describes behavior an interface can be made
  to exhibit. It becomes at least one probe.
- **process-rule** — the constraint is about the repository, the workflow, or
  the team rather than about the running app. It is EXCLUDED, with a
  one-line reason naming why driving cannot reach it. For example:

      append-only history is a repo property, not app behavior

An excluded constraint with no stated reason is an omission, not a
classification. Those reasons are what a human reads to decide whether the
sweep's silence on a constraint was honest; write them to be read.

### Write the charter

The charter is a document in the TARGET repo at `docs/qa/qa-plan.md`. It is
durable and repeatable: later sweeps re-read and extend it rather than
starting over, which is what makes a second sweep cheaper than the first.

Its shape:

1. **Purpose** — what this plan covers, what it deliberately leaves to
   automated tests, and, on a brownfield target, the basis label above.
2. **Preconditions** — what must hold before a sweep starts, read from the run
   contract rather than invented: `nahel doctor` exits 0, the contract's
   `test` command passes, then the contract's `launch` command brings the app
   up (with `seed` where the contract defines one).
3. **Run artifacts** — the layout every sweep writes into:

       docs/qa-runs/<UTC-timestamp>/
         report.md

   The timestamp is real, never estimated:

       date -u +"%Y-%m-%dT%H:%M:%SZ"

4. **Cases** — numbered `QA-01`, `QA-02`, … in one table with three columns:
   setup and actions, expected result, and what it traces to (the acceptance
   criterion, the hard constraint, or the bug item id). Steps must be exact
   enough for a different agent to execute them without asking what you meant,
   and the expected result is fixed BEFORE the sweep runs — an expectation
   written after the observation is not an expectation.
5. **Exploratory section** — a case that traces to nothing recorded is
   exploratory BY DEFINITION. It gets no QA-number and no row in the traced
   table; it lives here, as ground worth wandering. Do not invent a criterion
   to justify it.
6. **Coverage map** — the table below.
7. **Exclusions and known gaps** — what this plan does not cover and why,
   carrying every process-rule exclusion with its one-line reason.

### The coverage map

The charter ends with a coverage map: one table saying which ground is held by
which instrument. This is the scripted-versus-judgment split, stated instead
of assumed.

    | Ground | Committed scripts | Charter cases | Exploratory |
    | --- | --- | --- | --- |
    | <surface or criterion> | <script path, or —> | <QA-ids, or —> | <what is left to judgment, or —> |

Every row names ground; every cell is either filled or an explicit `—`.
A blank cell is a claim nobody made, and it reads as coverage.

### The exploration budget

Exploration beyond the charter is budgeted, and the budget is fixed here so no
sweep can quietly decide it explored enough. The budget is
**the larger of 30 probes or one probe per charter case**.
State that number in the charter and again in the sweep's report. A sweep that
stops because it hit the budget says so in the report — never silently, since
a budget hit with ground left over is exactly what tells the next sweep where
to start.

Before the charter's commit — before ANY commit this sweep makes — create
the sweep's branch, so nothing ever lands on the default branch directly. The
timestamp is the compact UTC form (`date -u +%Y%m%dT%H%M%SZ`) — colons are
not valid in a git ref:

    git checkout -b qa/<compact-UTC-timestamp>

Commit the charter on that branch, then journal its generation on this run:

    nahel log note --item <item-id> --run <run-id> \
      --data summary="charter generated: <n> traced cases, <n> exploratory, budget <n> probes" \
      --data charter=docs/qa/qa-plan.md \
      --data basis=<recorded-criteria|knowledge-docs>

## 3. Sweep — drive the app, journal the evidence

    nahel run update <run-id> --phase sweep

**The gate.** `nahel doctor` must exit 0 before a sweep starts — the same
autonomy gate every AFK run passes (`nahel/workflows/afk-run.md`). A contract
that does not hold on this machine means the app you are about to drive is
not the app the project describes, and every result you recorded would be
about your environment instead of about the software. Anything other than
exit 0 parks the sweep (below), naming the unset environment variables or the
failing healthcheck that doctor listed.

**Launch.** Bring the app up with the run contract's `launch` command, and
`seed` it where the contract defines one. Then drive the REAL interface: a
browser for a web application, the app's own CLI or HTTP calls for a service.
Tests passing is not driving; a page that renders is not a flow; re-reading
the code is not driving at all.

**The order is fixed**: the committed ratchet scripts (step 5) first,
then every charter case in charter order,
then budgeted exploration. Scripts are cheap and deterministic; exploration is
the expensive, unrepeatable part, so it goes last, against ground the charter
left open — edge inputs, sequence breaks, reload and persistence probes, empty
and overflow states.

Run the scripts by running the contract's `test` command, and journal that it
happened before any case was driven:

    nahel log note --item <item-id> --run <run-id> \
      --data summary="ratchet scripts run first: <the contract's test command> — <pass/fail>" \
      --data phase=scripts-first

### The event vocabulary

Every case and every probe is journaled on this run as a typed event. Four
types, and no others — a vocabulary that drifts is an onboarding brief that
lies to the next session.

- **`qa.result`** — one charter case that PASSED. Per case.

      nahel log qa.result --item <item-id> --run <run-id> \
        --data case=QA-<nn> \
        --data result=pass \
        --data <observation>=<what you saw that proves it>

- **`qa.finding`** — one charter case that FAILED, or an exploratory
  discovery indicating a defect. Per case.

      nahel log qa.finding --item <item-id> --run <run-id> \
        --data case=QA-<nn> \
        --data result=<fail|pass_with_known_issue> \
        --data bug=<bug-item-id> \
        --data <observation>=<what you saw>

  `bug` carries the item step 4 files for this finding, so file the item first
  and journal the finding second — a link added by a later correction is a
  link a reader has to go looking for.

- The `case`, `result` and `bug` keys, and both type names above, are the
  shapes the first QA sweeps in the wild already wrote on 2026-07-23. They are
  reproduced here VERBATIM and are not renameable: renaming one orphans every
  event already sitting in a target's journal. Extra observation keys are free
  — the journal's extension model is open — and are where the specifics belong
  (the seed used, the session id, the computed value, the URL driven).

- **`qa.probe`** — one exploratory probe beyond the charter: what you tried,
  what happened, and whether it indicates a defect.

      nahel log qa.probe --item <item-id> --run <run-id> \
        --data probe="<what you tried>" \
        --data observed="<what happened>" \
        --data defect=<yes|no>

- **`qa.sweep-completed`** — the whole-sweep summary, written once at the
  close (step 6). There is exactly ONE per sweep, and
  `nahel brief` reads ONLY this type for its QA line —
  so a per-case event must never carry this type,
  and a sweep must never write two — per-case and per-sweep are different
  scopes, and keeping them in different types is what lets a fresh session
  read one line and know where QA stands.

### Evidence or park — there is no third outcome

Every charter case ends in exactly one of three journaled states: a
`qa.result`, a `qa.finding`, or a park carrying its reason.
Zero silent omissions.
A case you could not drive — the surface does not exist yet, this
host has no tooling that reaches it, a precondition the contract does not
provide — is parked, named, and counted:

    nahel log note --item <item-id> --run <run-id> \
      --data summary="parked case QA-<nn>: <why it could not be driven, and what you tried>" \
      --data case=QA-<nn> \
      --data park=cannot-drive

"It looked fine" is not a result. "I ran out of budget" is a park, not a skip.

If the sweep as a whole cannot start — doctor is not green, or the app will
not launch — park the ITEM and stop, rather than reporting a sweep that never
drove anything:

    nahel item update <item-id> --status blocked
    nahel log note --item <item-id> --run <run-id> \
      --data summary="parked: cannot sweep — <which precondition failed, and what you tried>" \
      --data park=cannot-drive

### The branch and the PR

Every artifact a sweep produces — the charter, the run report, the scripts —
lives on the sweep's own branch in the TARGET repo, the `qa/<compact-UTC-timestamp>`
branch step 2 created before the charter's commit (compact form — a git ref
cannot carry colons).

The sweep closes — AFTER its final commit, when the report and any ratchet
scripts already exist on the branch — by opening a DRAFT PR, exactly like any
other lane's output:

    gh pr create --draft --title "qa/<timestamp>: sweep of <surfaces>" --body-file <file>

Its body carries the trail: the charter's basis, cases run / passed / failed /
parked, probes run and whether the budget was hit, every finding with the item
it filed, and the report path. A sweep is
never a direct commit to the default branch,
and it never merges its own PR: merge authority belongs to the target and is
exercised by `nahel/workflows/review-loop.md`. A sweep of a clean repo
leaves the default branch untouched.

## 4. Findings — every defect becomes a typed item

A finding that exists only in a report is a finding the project will lose. So
in the SAME run that found it, every failed case and every exploratory
discovery indicating a defect becomes a work item — with a repro somebody else
can follow, because the person who reproduces it will not be you.

**a. Check for a duplicate first.** Before filing anything:

    nahel status
    nahel recall <keywords from the symptom, in the target's own words>

A bug already open for this behavior gets a NOTE, not a twin:

    nahel log note --item <existing-bug-id> --run <run-id> \
      --data summary="re-found during qa sweep: <case or probe> — <what was observed>" \
      --data case=QA-<nn> \
      --data qa_run=<run-id>

Twins are how a backlog stops being readable, and a re-find is genuinely
useful information on the item that already exists: it says the bug survived
another release. Search before you file, every time.

**b. Defect, or question?** A defect means the app disagrees with something
recorded — an acceptance criterion, a hard constraint, a charter case's stated
expectation. Where nothing recorded says what SHOULD happen, you have found a
product question, and guessing the intended behavior is how a QA lane quietly
invents requirements. File it as a `chore` flagged for the human instead:

    nahel item new chore <slug> direct
    nahel log note --item <chore-id> --run <run-id> \
      --data summary="question for the human: <what the app does> — nothing recorded says whether this is intended" \
      --data question=product-behavior \
      --data case=QA-<nn> \
      --data qa_run=<run-id>

Do not park the sweep over a question and do not answer it yourself; the
question goes on the pile and the sweep carries on.

**c. File the bug with its repro.** The investigation stub is the deliverable
here, not the title. The bar: a fresh agent with no memory of this sweep can
reproduce the failure from the stub ALONE.

    nahel item new bug <slug> direct --investigation docs/investigations/<slug>.md

Write that document as you file it, carrying at minimum:

- **Repro steps** — the exact actions, in order, with the exact inputs used
  (the seed, the URL, the payload, the account state). "Click around the
  settings page until it breaks" is not a repro.
- **Expected vs observed** — what the recorded criterion or the charter case
  said should happen, and what actually happened, stated separately. Collapsed
  into one sentence they stop being checkable against each other.
- **Environment** — the commit SHA, how the app was launched, which surface
  you drove, and whatever the contract's `seed` put in place.

The document is the bug lane's starting point (`nahel/workflows/bug-lane.md`),
which is also where the fix lives. QA files it and moves on.

**d. Severity is a note, never new schema.** The store has no severity field
and does not need one; a judgment about cost belongs in prose that says why:

    nahel log note --item <bug-id> --run <run-id> \
      --data summary="severity <blocker|major|minor>: <what it costs a user, and how often>" \
      --data severity=<blocker|major|minor>

**e. Journal the case's `qa.finding` (step 3) — now, with the item filed.**
Carry `bug=<the item id you just filed>`, so the finding event and the item
point at each other and neither needs a later correction. The command prints
the event's id — keep it for the provenance note below.

**f. Provenance — the QA run rides the item's trail.** Every item this sweep
files carries the run that found it, so the path from sweep to finding to
filing is readable in one direction and back:

    nahel log note --item <bug-id> --run <run-id> \
      --data summary="filed by qa sweep: <case or probe> — from finding event <event-id>" \
      --data qa_run=<run-id> \
      --data finding=<qa.finding-event-id> \
      --data case=QA-<nn>

Read it back with `nahel progress --item <bug-id>` before moving on. A bug
item with no QA run in its trail
cannot be traced to the sweep that found it,
and an untraceable filing is indistinguishable from a guess somebody typed in.

## 5. Ratchet — exploration hardens into committed scripts

A check worth running twice is worth never running by hand again. Checks that
proved valuable — the ones that caught something, and the ones covering ground
a regression would be expensive to miss — graduate into deterministic
end-to-end scripts, committed to the target repo on this sweep's `qa/` branch.
Deterministic means fixed inputs and a fixed expected result: a script that
sometimes fails teaches everyone to ignore failures.

Four rules, none of them a sweep's to negotiate.

**1. Wired into the canonical test command — always, no side suites.** A
ratchet script joins the run contract's `test` command: the gate every run,
every review, and every verify-by-driving pass already executes. A suite
somebody has to remember to run is a suite that stops being run, and it stops
silently. If you meet a pre-existing side suite — QA scripts written before
this rule, sitting beside the contract's command — FOLD IT IN as part of this
sweep and say so in the report. A contract change is recorded through the CLI
like every other:

    nahel config set contract --data test="<the canonical command, now running the qa scripts>" ...

`config set` replaces the WHOLE section, so carry the contract's other fields
(`launch`, `seed`, the healthcheck) through in the same call or you drop them.
Never invent a second test command, and never wire a script anywhere else.

**2. The suite only grows.** A script, once merged, is
never deleted, never weakened, and never marked skipped by a QA run:
not to make a sweep green, not because it "seems flaky", not because the
feature moved on. An assertion that genuinely must change goes through the
ordinary human-reviewed PR path, like any other code change — it is never a QA
run's own act. And if a committed script now fails,
that is a FINDING (step 4), not a maintenance chore: the suite is reporting
exactly what it was committed to report.

**3. Red-first without a red suite: expected-fail markers.** A script for a bug
you FOUND but that is not FIXED cannot simply be committed red — a red suite
gates everyone else's work on a bug nobody has started on. Commit it with the
test framework's expected-failure marker, naming the bug item id in the
marker's reason:

    <the framework's expected-fail marker>("bug <bug-item-id>: <the failure this pins>")

The suite stays green, the repro is executable, and the bug carries an armed
test from the day it was filed. **QA never fixes the bug.** The fix is the bug
lane's (`nahel/workflows/bug-lane.md`), and flipping the marker to a plain
assertion is part of THAT fix — from then on the script
guards the recurrence forever. A sweep that fixes what it found has skipped a
diagnosis and destroyed the evidence for the one it skipped.

**4. Later sweeps run the committed scripts FIRST**, per step 3's fixed order,
and that order must be provable from the journal rather than asserted here. A
later sweep's journal shows its `phase=scripts-first` note
earlier than its first `qa.result` or `qa.finding`, and those earlier than its
first `qa.probe`. Ground a committed script already covers
is NOT re-explored: re-exploration is for new ground, and a budget spent
re-walking scripted paths is a budget that found nothing.

Journal the graduation on this run:

    nahel log note --item <item-id> --run <run-id> \
      --data summary="ratcheted: <n> scripts committed into the canonical test command" \
      --data scripts='["<path>", ...]' \
      --data expected_fail='["<bug-item-id>", ...]'

## 6. Close the sweep

Write the report, then the one event that summarizes the whole thing.

**The report** lands at `docs/qa-runs/<timestamp>/report.md` in the target
repo and records: the commit SHA swept, the UTC time, how the app was launched
and which surface was driven, the preflight results, the per-case status with
the observation that justifies each one, every probe and whether the
exploration budget was hit, every finding LINKED to the item it filed
(step 4), the scripts ratcheted in and the expected-fail markers armed
(step 5), the exclusions, and the overall verdict. Write it to be read without
the journal.

**The one summary event:**

    nahel log qa.sweep-completed --item <item-id> --run <run-id> \
      --data cases_run=<n> \
      --data passed=<n> \
      --data failed=<n> \
      --data parked=<n> \
      --data probes=<n> \
      --data budget_hit=<yes|no> \
      --data findings_filed='["<item-id>", ...]' \
      --data report=docs/qa-runs/<timestamp>/report.md

Exactly one, written last — after the findings are filed, because the counts
have to be final. A summary written mid-sweep summarizes a sweep that had not
happened yet.

Then end honestly and hand the item to review:

    nahel run end <run-id> success
    nahel item update <item-id> --status in-review

A sweep that found defects still ends `success` — finding them is the job, and
an outcome that punished discovery would teach the next sweep to look less
hard. `failure` is for a sweep that could not do the job: the app never came
up, or the charter could not be driven. `done` is not yours to grant; it comes
at the human's word, like every leaf item's.

Fallback (degraded environment): if the `nahel` CLI is unavailable, the
charter itself may still be written — it is prose derived from documents you
can read — but make NO item, run, or journal mutations, and say which ones are
pending so a CLI-equipped session can record them. A charter whose sources you
could not read is not a charter: without `nahel status` and `nahel brief`,
state that the criteria are unavailable rather than inventing cases to fill
the gap. Do NOT sweep without the CLI: an undriveable case, a finding, and a
probe are all evidence, and evidence that lands nowhere is evidence nobody
will ever act on. If the host cannot drive the app at all, park rather than
substituting a test run for a sweep. Ratchet scripts are ordinary code and may
still be written and committed, but wiring one into the canonical `test`
command is a `nahel config set contract` act — leave it pending and say so,
rather than hand-editing the contract.
