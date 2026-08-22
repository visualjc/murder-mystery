---
name: plan-frontier
description: Work one map's frontier AFK — claim a takeable decision ticket, answer it by type, resolve or release, and loop while the frontier still offers one
args: "<node-slug-or-id>"
---

# Workflow: plan-frontier

Load and follow this workflow to move ONE map forward with nobody watching.
This is a **standalone lane**: a human, a cron line, or a future orchestrator
invokes it against a single map, exactly the way `nahel/workflows/chart-map.md`
and `nahel/workflows/work-map.md` are invoked. Nothing dispatches it —
`nahel dispatch` and Runs are work-item-scoped by construction (ADR-0016) and a
product or initiative map may have no work item at all, so afk-run dispatching
this lane is a recorded successor delta, not this one. It needs no Run anyway:
every act below is a journaled CLI mutation under your `agent:*` actor, which is
the provenance the next briefing derives from.

Where `work-map.md` is one session, one ticket, one decision, this lane is one
session, one map, and as many tickets as the frontier still offers — because
nobody is waiting on the answer, and a lane that stopped after one would leave
the window unused. Everything else it borrows from work-map unchanged: the same
claim, the same resolution, the same `--source` discipline. Every state change
is a CLI call; never hand-edit anything under `nahel/`.

Before any `nahel` command: set `NAHEL_ACTOR=agent:<your-id>` — an AFK lane is
always an agent, and its acts must be attributable to it rather than to the
human whose machine it ran on. That attribution is also what arms the
human-only refusals in step 2.

1. Read the mode, then the map. The governance mode decides which ticket types
   are yours at all, so resolve it before you claim anything:

       nahel brief
       nahel roadmap map show <node-slug>

   `brief`'s **governance & merge authority** section names the effective
   `product` mode — `human`, `delegated`, or `agent`. Take the effective value,
   not the configured one: a posture an agent set resolves back to `human`, and
   this lane is exactly the caller that must not talk itself past that. The map
   carries the destination and the decisions so far, which are the context every
   answer below is made in — read it once, at the top, not per ticket.

2. Ask what is takeable, and pick ONE:

       nahel roadmap frontier <node-slug>

   The frontier lists exactly the takeable tickets — `open`, unclaimed, every
   blocking ticket already settled — and marks the restricted ones. Work only
   decision tickets on THIS map; the work items the frontier also lists belong
   to other lanes.

   The skip matrix is the mode applied to the type. It is discipline, not
   permission: read it as what you decline to attempt, not as what you would
   otherwise be stopped from doing.

   | ticket | `governance.product: human` | `delegated` / `agent` |
   | --- | --- | --- |
   | `research` | work it | work it |
   | `task` | work it | work it |
   | `prototype` | build the variants, park the verdict (step 4) | build the variants, judge per prototype-lane |
   | `grilling` | **SKIP** — the interview is the human's | work it THROUGH a cross-agent grill (step 4); solo only as recorded fallback |
   | anything marked `[human-only]` | **NEVER touch** | **NEVER touch** |

   A `grilling` ticket under `human` governance is skipped because answering it
   yourself does not produce the human's decision — it produces yours, wearing
   their ticket. Leave it unclaimed and it is waiting for them, which is the
   whole point of the type.

   `[human-only]` is absolute under every mode. The CLI is the backstop: under
   an `agent:*` actor `ticket resolve`, `ticket close`, and `ticket update
   --clear-human-only` are all REFUSED, naming you. Do not treat the refusal as
   the rule — the rule is that you skipped it. A lane that discovers the flag by
   being refused has already spent the research it is about to throw away.

3. Claim it before you work it, so concurrent sessions skip it:

       nahel roadmap ticket claim <ticket-id>

   This is advisory assignment, NOT `nahel intervene claim`'s freeze: it records
   who is working the question and locks nothing. If it refuses, naming a
   holder, that ticket is someone else's — take the next one. **Never work a
   ticket you did not claim**, and never release someone else's to take it: this
   lane is one of several sessions that may be running right now, and the claim
   is the only thing keeping two of them off one question.

4. Answer it with the surface its **type** names.

   **`research` — two lenses, both of them, journaled separately.** One ticket
   type covers both directions, and the question's wording weights them; neither
   is optional because a decision made on one lens is a decision made on half the
   evidence. Outside-in: the web, competitors, prior art, published examples,
   user demand — whatever your harness's web tools reach. Inside-out: this
   codebase, this store, the journal, the ADRs, `nahel recall <terms>`. Journal
   each lens as its OWN note, and keep the event id each one prints:

       nahel log note --data ticket=<ticket-id> --data lens=outside-in \
         --data summary="<what the outside world said, and where>"
       # ✅ logged note — event <event-id> (seq n) → session-…

       nahel log note --data ticket=<ticket-id> --data lens=inside-out \
         --data summary="<what our code and store said, and where>"

   The `ticket=<ticket-id>` key is not decoration and not optional: it is the
   link that puts this note in the ticket's own briefing window, so a human
   reading `nahel plan` tomorrow sees the research beside the decision it
   produced. A note without it is work nobody will find. Two lenses in one note
   is the same loss in a different shape — the whole point is that a reader can
   see which lens said what.

   **`prototype` — the bridge, not a shortcut around the lane.** A prototype
   ticket is answered THROUGH `nahel/workflows/prototype-lane.md`, as written:

       nahel item new prototype <slug> direct
       nahel log note --item <prototype-item-id> --data ticket=<ticket-id> \
         --data summary="prototype <slug> opened to answer <ticket-id>"

   Then run prototype-lane from its step 1 — variants, mini-PRDs, throwaway
   code, journaled findings, and its judgment step INCLUDING the human-judgment
   park: under `governance.product: human` the verdict is the human's, parked
   rather than decided (`nahel/workflows/afk-run.md` step 12). So this lane
   "answers" a prototype ticket only as far as **building the variants**. Do not
   resolve the ticket. Leave it open, release your claim, and let the linking
   note be what points at the waiting prototype:

       nahel roadmap ticket release <ticket-id>

   Before claiming a prototype ticket at all, check whether a note already links
   it to a prototype item that is still alive — the frontier will offer it again
   precisely because you released it, and a second lane that re-opens variants
   for a question already in flight burns the window twice. Under `delegated` or
   `agent` governance the verdict is yours to record, and prototype-lane's own
   rules govern it; only then does the ticket resolve, citing the verdict
   observation and the variants' findings.

   **`task` — do it, then say what doing it settled.** The answer was known; the
   act is what produces the record. Journal what the doing revealed (it is
   rarely nothing), with the same `ticket=` key, then resolve citing it.

   **`grilling` under `delegated` or `agent`** — the grilling POSTURE survives
   the missing human: you answer it through a **cross-agent grill**, never as a
   monologue (ticket jhxg756e — an agent answering its own interview question
   is the exact smell the HITL rule exists to prevent; removing the human
   removes the human, not the interview). Run it as the house's capped
   cross-vendor loop pointed at a decision ticket, second VENDOR preferred
   (codex ↔ claude, claude ↔ cursor; consult `setup-routing.md` for what this
   store routes where — a same-vendor second agent is better than none):

   1. Draft your position — decision, rationale, evidence — and journal it as
      a `ticket=`-keyed note.
   2. Hand the draft to the other agent with the ticket's question and the
      map's destination, instructed to PROBE AND REFUTE, not to agree. Journal
      its counter as its own `ticket=`-keyed note under ITS actor when it runs
      CLI-side, or quoted in yours when it cannot.
   3. Revise or defend; stop at convergence or after a small fixed round cap
      (two or three — a grill that cannot converge is a finding that the
      question belongs to the human: release the claim and leave it).
   4. Resolve citing BOTH sides' notes, and write the `--rationale` to be
      defended later: the recommendation, what the other agent attacked, what
      survived and why, and what evidence would change it. A human reading it
      next week must be able to overturn it on the merits rather than on the
      fact that agents wrote it.

   **Solo is the recorded fallback, not a choice**: only when no second agent
   is reachable (offline, no routed vendor, spawn refused) may you answer
   alone — and the resolution must SAY so and why, so a solo answer can never
   pass as a grilled one. The same applies to a DD6-delegated ticket under
   `human` governance: the human's delegation hands the question to the PAIR,
   not to one agent's defaults.

5. Record the decision, citing everything you journaled:

       nahel roadmap ticket resolve <ticket-id> \
         --decision "<the decision, in one line>" \
         --rationale "<why — as many lines and paragraphs as it takes>" \
         --source <outside-in-note-id> --source <inside-out-note-id>

   Pass EVERY note id, repeating the flag: they land in the distilled
   observation's provenance as structured refs, so `nahel recall` reaches the
   decision and the decision reaches the research. A `--source` must name an
   event this store already recorded — a typo is refused rather than written.
   Write the one-liner as the answer, not the topic. Close instead of resolving
   when the question will not be answered, saying which of the two reasons it is
   (`--out-of-scope` or `--invalidated-by`); the wording, the dispositions, and
   the fog graduation that follows are `work-map.md` steps 4 and 5, unchanged.

   If you cannot finish — the research is inconclusive, the tools you needed are
   not here, the answer turns out to need the human — hand it back rather than
   guessing:

       nahel roadmap ticket release <ticket-id>

   A released ticket is back on the frontier for the next session, and the notes
   you already journaled stay attached to it by their `ticket=` key. That is a
   good outcome. A ticket answered thinly because the lane wanted a resolution is
   a bad one, and it is worse than the release because it looks finished.

6. Loop. Re-run the frontier — do not work from the list you took in step 2:

       nahel roadmap frontier <node-slug>

   It has changed under you. Your own resolution may have unblocked dependents,
   a concurrent session may have claimed or resolved things, and a ticket you
   skipped in step 2 may now be someone's. Take the next takeable ticket the
   matrix allows and go back to step 3. Stop when the frontier offers none —
   when what remains is blocked, claimed, skipped by the matrix, or gone.

7. Leave the map clean and claim nothing you are not working:

       nahel roadmap ticket release <ticket-id>   # anything still claimed by you
       nahel validate

   A claim outliving the session that made it is the one piece of litter this
   lane can leave: it is invisible on the frontier and it silently withholds a
   question from every later session.

**There is no report file.** Do not write one. Findings surface through the next
`nahel plan` briefing's *since your last session* block, which is derived from
exactly what you wrote here: the ticket events, the resolutions and their
one-line decisions, and the notes carrying the `ticket=` key. The journal IS the
report — a summary document beside it would be a second copy, unversioned,
un-cited, and stale the moment the next session acts.

## Scheduling

**nahel never schedules anything.** It is a deterministic CLI with no daemon, no
timer, and no LLM inside it — a hard constraint, not a gap waiting to be filled.
Nothing in this repo will ever wake this lane up. Scheduling is the HARNESS's
job, and the shim `nahel install` generates is what makes it a one-liner.

A cron line running the lane headlessly against one map every night:

    0 2 * * * cd /path/to/repo && NAHEL_ACTOR=agent:afk-frontier \
      claude -p "/nd:plan-frontier deployment-devops-workflows" >> /tmp/plan-frontier.log 2>&1

The same thing under codex, whose non-interactive subcommand is `exec` and whose
shims are flat prompt files:

    0 2 * * * cd /path/to/repo && NAHEL_ACTOR=agent:afk-frontier \
      codex exec "/prompts:nd-plan-frontier deployment-devops-workflows" >> /tmp/plan-frontier.log 2>&1

Harness-native scheduled agents work the same way and are usually better: they
carry their own logging, retries, and credentials, so the schedule stops being
a crontab nobody remembers editing. Whatever the mechanism, keep two things
true — give the lane a **distinct actor id** (`agent:afk-frontier`, not the id
your interactive sessions use, so its work lands inside the human's briefing
window rather than advancing their baseline past it), and point each invocation
at ONE map. A scheduler that fans across three maps is three lines, not one
invocation with three arguments.

Fallback (degraded environment): if the `nahel` CLI is unavailable, STOP. This
lane's siblings can proceed and report because a human is reading their output;
here nobody is, so research nobody records is research nobody will ever see, and
an unclaimed ticket worked without a claim is a collision waiting for the next
session. Exit, and say which map went unworked and why — the run is a no-op, not
a partial one. If the web tools one lens needs are missing, that is not a
degraded environment: journal the inside-out lens, journal the gap as the
outside-in note, and release the ticket rather than resolving a two-lens
question on one lens.
