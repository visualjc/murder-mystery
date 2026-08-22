---
name: work-map
description: Work one decision ticket off a map — claim it, answer it with the right surface, record the decision, graduate the fog
args: "<node-slug-or-id>"
---

# Workflow: work-map

Load and follow this workflow to move a wayfinder map forward by **one
ticket**. One session, one ticket, one decision: a session that resolves
four tickets has usually answered three of them with the momentum of the
first. Every state change below is a CLI call; never hand-edit anything
under `nahel/`.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

1. Ask what is takeable, then read the map it belongs to:

       nahel roadmap frontier <node-slug>
       nahel roadmap map show <node-slug>

   The frontier lists exactly the takeable tickets — `open`, with no claimant,
   and every blocking ticket already `resolved` or `closed` — so you never have
   to work that out by eye. The map is still worth reading: it carries the
   destination and the decisions so far, which are the context the next one is
   made in. When the frontier is empty it says why (blocked, or claimed).

   Blocking is **advisory**: you may deliberately take a blocked ticket when
   you judge the dependency soft — say so in the decision when you do, so the
   next reader knows it was a choice. Nothing refuses you.

2. Claim it, so other sessions skip it:

       nahel roadmap ticket claim <ticket-id>

   This is advisory assignment, NOT `nahel intervene claim`'s freeze: it
   records who is working the question and locks nothing. If the ticket is
   already claimed the command refuses, naming the holder — pick another, or
   release theirs if that session is plainly gone.

3. Answer it with the surface its **type** names:

   - `research` — read the code, the journal, the docs, the web when
     available. Journal each source as you go, and **keep the event id it
     prints** — step 4 hands those ids to the resolution:

           nahel log note --data summary="<what this source said>"
           # ✅ logged note — event <event-id> (seq n) → session-…
   - `prototype` — run `nahel/workflows/prototype-lane.md`. The variants are
     throwaway; what comes back is the answer, not the code.
   - `grilling` — interview the human with the pinned `grilling` skill (its
     fallback: name every branch, never answer for them). When the question is
     about vocabulary or the shape of the domain, use `domain-modeling`
     instead — the decision it produces belongs in the glossary too.
   - `task` — just do it, then record what doing it settled.

   Read the map's other decisions first: `nahel roadmap map show <node-slug>`
   lists them, and `nahel recall <terms>` finds the reasoning behind any of
   them. A decision that contradicts an earlier one is a finding, not a typo.

4. Record the decision. This is the act the whole workflow exists for:

       nahel roadmap ticket resolve <ticket-id> \
         --decision "<the decision, in one line>" \
         --rationale "<why — as many lines and paragraphs as it takes>" \
         --source <event-id-from-step-3> --source <another>

   One command does three things: it journals the decision, flips the ticket,
   and distills an **observation** so `nahel recall <terms>` finds the decision
   forever. The map's index line needs no fourth: **Decisions so far** is
   derived from the resolved tickets, so the map record is never touched and
   two sessions resolving two tickets on one map never collide. Write the
   one-liner as the answer, not the topic — "we own the fly.io deploy and
   nothing downstream of it", never "deploy target decided".

   `--rationale` is optional and worth almost always writing: the one-liner
   says WHAT was decided, and it is the only thing that says WHY. It is stored
   verbatim in the observation — paragraphs kept — so it survives step 6's
   distill, and it never becomes a map row. Pass it blank and you are refused;
   omit it when there is genuinely nothing to add.

   `--source` closes the loop step 3 opened: pass every note id you collected,
   repeating the flag. They land in the observation's **provenance** as
   structured refs, so `nahel recall` reaches the decision and the decision
   reaches the research — which prose in a body cannot do, and which the body
   could not keep anyway once step 6 empties it. A `--source` must name an
   event this store already recorded: a typo is refused rather than written,
   because an observation citing an event nobody journaled is a `nahel
   validate` error.

   If the question is not going to be answered, close it instead — and say
   WHICH of the two reasons it is, because they are different facts and only
   one of them belongs in Out of scope. Neither ever becomes a decision:

       nahel roadmap ticket close <ticket-id> --out-of-scope \
         --reason "<why this is beyond the destination>"

       nahel roadmap ticket close <ticket-id> --invalidated-by <ticket-or-event-id> \
         --reason "<which decision answered it out of existence>"

   `--out-of-scope` earns the reason a line under the map's **Out of scope**
   section: ruled beyond the destination, and it never graduates.
   `--invalidated-by` records the decision that killed the question on the
   ticket, and the map shows it beside Decisions so far — a question another
   decision answered was never beyond the destination, so filing it under Out
   of scope would be false, and would turn the one section that bounds the map
   into a graveyard nobody trusts. Both readings are derived from the closed
   ticket; like `resolve`, neither disposition writes the map.

   A close distills an **observation** too, under either disposition, so the
   question and the ruling survive step 6's distill and `nahel recall` still
   finds what was ruled away. Write the `--reason` the way you would write a
   decision: the answer, not the topic.

   If you are stopping without an answer, hand it back:

       nahel roadmap ticket release <ticket-id>

5. Let the fog graduate. A fog line the decision sharpened into a real
   question becomes a ticket, and the fog section is re-stated without it:

       nahel roadmap ticket new --map <node-slug> --type <type> --question "<the question, now sharp>"
       nahel roadmap map update <node-slug> --fog "<every fog line that is still foggy>"

   New fog is a good outcome too: an answer that opens two questions has told
   you something. Add them the same way.

6. Distill the ticket once the decision reads back without it:

       nahel recall <a few words from the decision, or from the question you closed>
       nahel roadmap ticket distill <ticket-id>

   `distill` empties the ticket's body **through the CLI** — never with an
   editor, which `nahel validate` reports as a finding. Check `recall` first:
   the body may go only because the decision, and the question it answered,
   already live in the journal and in the observation. A CLOSED ticket distills
   the same way and for the same reason — its close wrote an observation too.

7. Confirm the shape and leave the map readable:

       nahel roadmap map show <node-slug>
       nahel validate

Fallback (degraded environment): if the `nahel` CLI is unavailable, the
research or interview may proceed — but make NO ticket, map, or journal
mutations; report the decision you reached and which ticket it answers so a
CLI-equipped session can record it. An unrecorded decision is a decision the
next session will make again, differently.
