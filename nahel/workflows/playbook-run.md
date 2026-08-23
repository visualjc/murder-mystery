---
name: playbook-run
description: Drive a playbook as the host agent — resolve, write-ahead, execute per exec mode, commit the envelope, and rebuild a crashed run from the journal alone
args: "<playbook-name> <item-id>"
---

# Workflow: playbook-run

Load and follow this workflow to drive ONE playbook — a named, ordered,
multi-role dispatch recipe under `nahel/playbooks/` — against one work item.
This is the only mechanics doc a playbook needs; a playbook that wants its own
procedure prose is a playbook whose steps are not saying enough.

The division of labour, and everything below follows from it: **the CLI
resolves and instructs, you execute and journal.** There is no CLI-owned
sequencing loop — nahel will never run step 2 because step 1 finished. Chaining
one step's output into the next is your judgment, expressed as a *binding* you
commit. The CLI never reads meaning from any vendor's output; it stores bytes
and hands them back verbatim.

The lifecycle mechanics this shares with everything else — the run, journaled
findings, the claim rule, git discipline — are
`nahel/workflows/task-lifecycle.md`'s; follow it alongside this one. Every state
change is a CLI call; never hand-edit anything under `nahel/`, playbook YAML
included (`nahel playbook new`/`edit` are its only doors).

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>`, so every event this drive produces carries your
identity — and so the roles you spawn are attributed to *their* vendors rather
than to you. `nahel dispatch` sets each worker's `NAHEL_ACTOR` itself; never
override it to your own.

## 1. Read the recipe

    nahel playbook list
    nahel playbook show <playbook-name>

`show` prints the steps in order, each with its roles and guidance. Order is the
recipe: a playbook is driven top to bottom. A step naming more than one role is
a **panel** — one question asked of N executors (step 6).

If the playbook does not exist yet, author it with `nahel playbook new`; if a
step is wrong, fix it with `nahel playbook edit`. Both refuse a role
`config.roles` does not define, and both journal the act.

## 2. Open the run the playbook rides on

A playbook run is not a new kind of record. It is an ORDINARY run on the work
item, and every envelope below is journaled against that item and that run:

    nahel item update <item-id> --status in-progress
    nahel run start <item-id>

`run start` prints the run id. Carry it through every step of this drive —
`--item` and `--run` together are the coordinate that makes an envelope
addressable, and the pair is what a resuming session looks the drive up by. One
drive of one playbook is one run; re-driving the same playbook for the same item
after a failure is a NEW run, which is what keeps the two attempts legible as
two attempts.

## 3. Resolve the step

Never execute from memory of the recipe — resolve it, every step, every time:

    nahel playbook resolve <playbook-name> --step <step-id> \
      --item <item-id> --run <run-id>

Resolution is pure config math: nothing is spawned, nothing is journaled, no
clock is read, so resolving is free and its output is byte-identical on every
machine. What it prints per role:

- the **route** — `exec=`, the agent CLI, the model and effort, and the
  `config.roles` key that answered;
- for `exec=spawn`: the composed argv AND a paste-ready
  `nahel dispatch --role …` command;
- for `exec=subagent` / `exec=self`: a **HOST DIRECTIVE** block — the role, its
  exec mode, model and effort, the rendered guidance, and the exact
  `nahel playbook step commit` command to run afterwards;
- the step's `envelope:` commands.

Guidance may embed `{{bindings.<key>}}` placeholders. `resolve` fills them ONLY
from step envelopes already COMMITTED for this item+run — never from your memory
of what a role said, never from a file you happen to have open. A step whose
placeholders are unbound is refused, naming the keys and the earlier steps that
have not committed. That refusal is the mechanism, not an inconvenience: it is
what makes "a downstream step consumes only committed output" true rather than
merely intended.

Resolving without `--item`/`--run` is a legitimate PREVIEW — placeholders stay
visible, the commands carry `<item-id>`/`<run-id>` — but a preview is for
reading, never for executing.

## 4. Write-ahead: start the step

Before anything executes, journal what is being asked:

    nahel playbook step start <playbook-name> <step-id> \
      --item <item-id> --run <run-id> [--input @<path-to-the-input>]

The GUIDANCE is materialized for you: `start` renders it through the bindings
this item+run has already committed — the same render step 3 printed — and
refuses on an unbound placeholder exactly as `resolve` does. So the journal
carries the question the roles actually receive, not the template. `--run` must
be an ACTIVE run of `--item`.

`--input` is optional EXTRA context beside that guidance: inline text or
`@<file>`, bytes stored verbatim. A step that was started and not committed is
visibly **in flight** in `nahel progress`, which is precisely what a crash
should leave behind: proof of what was asked.

Re-starting a step you started but never committed is fine — that is the honest
re-ask after a crash. Starting one already COMMITTED on this item+run is
refused: a completion is recorded once, so another attempt goes under a fresh
run.

Do not skip this because the step is "small". `step commit` refuses a step
nothing started, and it is right to: an envelope with no write-ahead is a claim
about work nobody can show was requested.

## 5. Execute, per exec mode

Three modes, three different things you do. `resolve` told you which:

- **`exec=spawn`** — run the printed `nahel dispatch --role …` command. That
  spawns the agent CLI with the role's model and effort, under the role's own
  actor identity, and journals the dispatch bracket with the playbook, the step
  and `--drive-run` (your drive's run, not the one the dispatch opens for the
  worker) on BOTH ends — which is what lets a reader attach the bracket to this
  envelope even with a second drive of the same item in flight. Save the
  worker's output to a file; it becomes the step's output artifact in step 6.
  Never re-type the argv by hand — the printed command is the composed one.
- **`exec=subagent`** — you execute it through YOUR OWN tool's subagent
  mechanism (a Task/subagent call in-session), following the HOST DIRECTIVE's
  role, model, effort and guidance as closely as your mechanism allows. Nothing
  is spawned by nahel, so nothing is journaled by nahel: the subagent's result
  reaches the store only as the binding and output artifact you commit in step 6.
  If your mechanism cannot honour the directive's model or effort, say so in the
  commit's binding — an unstated substitution is a lie about what produced the
  answer.
- **`exec=self`** — you do the work yourself, in this session, per the
  directive's guidance. Same rule: it lands in the store only through the commit.

Whatever the mode, a role's output is the role's own words. Do not summarize an
adversary into agreement with yourself before it is stored; store the bytes,
then form your view.

## 6. Panels — fan out, commit once

A step with N≥2 roles is a panel: ONE question, N executors, and **ONE
envelope**. Drive it as a unit.

- Fan the roles out **in parallel** where your tooling can (parallel dispatches,
  parallel subagent calls). Sequential is a fallback, not a failure.
- **Cross vendors.** An adversarial panel routed to one agent CLI buys cost, not
  a second opinion: one vendor asked twice tends to agree with itself.
  `nahel validate` warns (`playbook.panel-single-vendor`) on a panel whose roles
  all name the same `agent`. Treat the warning as the finding it is — route one
  role elsewhere, or state why the same-vendor panel is what you want.
- **Record partial failures honestly.** One envelope carries a terminal status
  for EVERY role: `ok`, `failed`, or `skipped`. A panel where one role died and
  one delivered is committed exactly that way — the survivor's output is KEPT
  and bound, the dead role is `failed`. Never drop the survivor to make the step
  look clean, and never mark a role `ok` because its partner covered the ground.
- **You decide re-runs.** The CLI never retries. If a `failed` role has to run
  again, that is a fresh drive of the step under a new run (an envelope is
  written once, and committing a step twice on one run is refused).

## 7. Commit the envelope

The atomic completion record — executor identity, per-role terminal status, each
role's output stored verbatim, and the bindings downstream steps consume:

    nahel playbook step commit <playbook-name> <step-id> \
      --item <item-id> --run <run-id> \
      --executor <actor> \
      --role-status <role>=<ok|failed|skipped> \
      --output <role>=@<path-to-that-role-s-output> \
      --binding <key>=<text|@file>

- `--executor` is WHO ran the step — the routed agent for a spawn step, you for
  a self step — which is not necessarily the actor typing this command.
- `--role-status` is required for every role the step's START journaled — the
  cast as it was ASKED, not the playbook file as it reads now, so an edit
  between the two halves cannot change what this envelope describes. `skipped`
  is the word for a role you chose not to run; an omission is refused, because
  an unfinished envelope claiming completion is exactly what a resuming session
  is misled by.
- `--output` copies the file's bytes under the run's artifacts directory and
  journals the stored path. Artifacts are files, never inline text.
- `--binding` is your JUDGMENT, made durable: the value a later step's
  `{{bindings.<key>}}` will be rendered with. Bind the thing the next step
  actually needs — a path, a verdict, the adversary's findings — and name the
  key the way the later step's guidance spells it.
- Binding keys are WRITE-ONCE per playbook+item+run: a key an earlier step
  already committed is refused, naming its owner. A resolved plan must not
  change under the host that resolved it — correct it under a fresh run.
- Passing any of these flags twice for the same key in one commit is refused
  too. A role cannot be both `ok` and `failed`, and silently keeping the last
  one would discard the half you meant.

Then journal the roles' token usage as a note, when the vendor's output exposes
it — a CONVENTION, never a schema requirement (ticket `qtqm68mx`), and never a
guess:

    nahel log note --item <item-id> --run <run-id> \
      --data summary="tokens <playbook>/<step>: <role>=<in>/<out>, <role>=<in>/<out>"

A vendor that reports nothing gets no note. Nahel does not normalize cost, and a
fabricated number is worse than a missing one.

## 8. Repeat, then close

Steps 3–7 again for the next step, in the playbook's order. When the last step
is committed, close the drive the ordinary way (task-lifecycle step 5):

    nahel run end <run-id> success
    nahel item update <item-id> --status in-review

A drive that gave up closes too — `nahel run end <run-id> failure` — with the
reason journaled. An abandoned `active` run is a lie in the state.

## 9. Crash-resume — a fresh session, from the journal alone

A drive that died mid-flight is reconstructable with no memory of the session
that started it. From a fresh session:

1. Read the trail: `nahel progress --item <item-id>`. It carries the
   `playbook.step-started` and `playbook.step-committed` events of every step,
   plus both ends of every dispatch bracket with their playbook and step keys.
2. Find the LAST committed envelope. Every step up to and including it is done,
   and its bindings are available.
3. A step with a `step-started` and no `step-committed` was **in flight** when
   the crash happened. Its write-ahead input tells you exactly what was asked.
   Decide from the trail whether the work actually happened (a `dispatch.ended`
   for that step's role says a worker finished) — if it did and the output
   survives, commit the envelope now; if it did not, re-run the step.
4. Re-run ONLY uncommitted steps. Re-resolve each one (step 3) — resolution is
   pure, so it will render from the same committed bindings the crashed session
   had, byte for byte.
5. Never reconstruct a binding from your own reading of a worker's output when
   the envelope for it was never committed. Re-run the step instead. A binding
   invented on resume is the one failure mode this whole envelope discipline
   exists to prevent.

Resume under a NEW run when the old run was ended, or continue on the same run
when it is still `active` and uncommitted work remains — but never mix: one
drive's envelopes belong to one run id.

## 10. No shortcuts

The prototype that proved this design out ran on shortcuts — resolution without
envelopes, bindings passed in the driver's head, panels summarized before they
were stored. **None of those merge.** If a step feels like it does not need the
write-ahead, or a binding feels obvious enough to skip, that is the exact state
in which a crash becomes unrecoverable and a panel becomes one opinion wearing
two names. Drive every step through steps 3–7, or do not claim the playbook ran.

Fallback (degraded environment): if the `nahel` CLI is unavailable, the WORK may
proceed — you can still ask a model a question — but make NO status, run,
envelope, or journal mutations, and do not drive a playbook to completion on
that basis: a step with no envelope is a step no later session can consume or
resume, so the drive has produced prose, not a playbook run. Report what was
executed and which envelopes are pending so a CLI-equipped session can record
them. If `nahel dispatch` in particular is unavailable but the CLI works, a
spawn role may be executed by hand from the argv `resolve` printed — record the
step's envelope exactly as if it had been dispatched, and say in the binding that
the dispatch bracket is missing.
