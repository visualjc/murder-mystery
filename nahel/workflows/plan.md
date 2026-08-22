---
name: plan
description: Run a planning-partner session — place the altitude, grill the human, fire research, and hand off the moment they say enough to start
args: "[node-slug-or-id]"
---

# Workflow: plan

Load and follow this workflow to run a **planning session**: the partner
posture over the roadmap and its maps. You are the judgment; the CLI is the
state. The session works at one of three **altitudes**, and placing the
conversation at the right one is your FIRST move — the human may not know
which they want, and that is normal, not a failure to correct:

- **Ideation** (10k ft) — "wouldn't it be cool if": surfacing candidate
  features. Lightest ceremony.
- **Roadmap shaping** (5k ft) — creating, editing, and moving roadmap nodes
  like a mind map, without going deep on any of them.
- **Feature definition** (PRD level) — how one feature works: full map
  discipline via `nahel/workflows/chart-map.md` and `work-map.md`.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

1. Open with the briefing:

       nahel plan            # bare: single product briefs it, several list and ask
       nahel plan <ref>      # focused on one node

   Read it top to bottom, and DEBRIEF FIRST: the "since your last session"
   block is what moved while the human was away — resolved tickets, new
   findings, shifted fog. Walk them through it before asking anything new;
   returning to a map should feel like returning to a colleague, not
   starting over. (The briefing's reader defaults to the human; an
   agent-as-PO session passes `--reader <its-own-actor>`.)

2. Place the altitude. A `<ref>` that is a feature node is a strong hint
   for feature definition; a bare invocation or a product ref means you
   ask. One question, plainly: are we dreaming up features, shaping the
   map, or defining one? Move BETWEEN altitudes when the conversation
   drifts — an ideation session that lands a winner naturally descends
   into shaping ("add it to later"), sometimes further. Say the shift out
   loud; never relitigate a settled altitude.

3. Hold the posture the altitude names. Ceremony scales DOWN as altitude
   goes up:

   - **Ideation**: converse. A blessed idea graduates to a later-horizon
     node (`nahel roadmap node new feature <slug> --horizon later
     --parent <product> --intent "<the capability, not the plan>"`).
     A rejected one lands as an out-of-scope line on the product's map,
     with the why — so it is never re-brainstormed cold. Nothing else is
     recorded; candidate ideas live in the conversation until blessed.
   - **Roadmap shaping**: node mutations ARE the record — `node new`,
     `node update --horizon/--intent/--parent`, mind-map style. Only a
     genuinely contested question earns a ticket on the product's map.
     End the session with ONE journaled note summarizing what moved and
     why (`nahel log note --data summary="..."`) — that note is the
     rationale trail `nahel recall` finds later.
   - **Feature definition**: full map discipline. Chart with
     `chart-map.md`; work tickets with `work-map.md`; this workflow is
     the conductor around them, not a replacement.

4. Interview like a partner, not a stenographer. Use the pinned `grilling`
   skill when installed (fallback: one question at a time, never
   compound, recommendation attached to every question). The lines that
   hold at every altitude:

   - Grilling tickets are HITL under `human` governance: you NEVER answer
     your own interview question — except through a recorded delegation
     (step 6) or under `delegated`/`agent` governance. And even then the
     answer comes out of a **cross-agent grill**, not a monologue: a second
     agent (second vendor preferred) probes and refutes your draft before
     you resolve, per the grilling procedure in `plan-frontier.md` step 4;
     solo-with-rationale is only the recorded fallback when no second
     agent is reachable, and the resolution says so.
   - A ticket flagged `[human-only]` is answered by the human under EVERY
     governance mode; the CLI refuses an agent actor regardless.

5. Fire research as you go; never let it stall the interview silently.
   When a sharp question needs facts, cut a `research` ticket and start
   it immediately — preference order: a subagent when your harness spawns
   them; inline right now when it is short; otherwise leave the ticket
   open and unclaimed for the AFK lane (`nahel/workflows/
   plan-frontier.md`). Research is TWO-LENS when the question spans them:
   outside-in (the web — competitors, prior art, user demand, examples)
   and inside-out (this codebase and this store) — each lens journaled as
   its own note CARRYING the ticket key, so the findings reach the next
   briefing:

       nahel log note --data ticket=<ticket-id> --data lens=outside-in --data summary="<finding>"

   When pending research is LOAD-BEARING for the next question, ASK the
   human: wait for it, or continue — and on continue, reorganize the
   remaining questions around what is answerable now, returning to the
   blocked branch when findings land (this session, or the next via the
   briefing). Prototypes likewise get STARTED, not awaited: create the
   prototype work item, journal a `ticket=<id>` linking note, run
   `prototype-lane.md` as written — its verdict rules decide when the
   ticket resolves, and the lane's human-judgment park is never yours to
   skip.

6. Delegation — "use your default recommendations." At any point the
   human may hand you named unresolved questions instead of answering
   them. Record it before acting on it:

       nahel log note --data summary="delegation by <human>: tickets <ids> to agent defaults — <their words, near enough>"

   The delegation hands each named ticket to the PAIR, not to your
   defaults alone: run the cross-agent grill from `plan-frontier.md`
   step 4 — your stated default as the drafted position, a second agent
   probing it — then resolve with the surviving decision, your reasoning
   as the rationale, and the delegation note's event id among the
   `--source` refs beside both sides' notes, so the trail reads
   "delegated here, grilled so, answered so, because." Solo is the
   recorded fallback only when no second agent is reachable. Per-ticket,
   per-delegation: it is never a standing mode change, and a
   `[human-only]` ticket is never delegable — the CLI refuses even if the
   human waves it through here; that flag is cleared (by them) first or
   the question waits.

7. "Enough to start" — the cut check, then the handoff. When the human
   says some form of it, walk every remaining fog line and open ticket on
   the feature's map and sort each into two piles, out loud:

   - **Outside this delta** — not needed for the slice being shipped.
     Stays on the map, keeps resolving; it will sharpen into a successor
     node (`--predecessor` linked) later. It never enters the PRD.
   - **Inside this delta** — the slice cannot be built without it. Three
     doors, the human picks per question: resolve now, re-cut the delta
     smaller so it falls outside, or delegate (step 6).

   Then hand off to `nahel/workflows/prd-new.md`, which takes the map-fed
   path: settled sections citing their tickets, open questions empty by
   construction. The map STAYS OPEN — build starting before the map is
   finished is the anti-waterfall rule working, not a shortcut.

8. Close the session legibly: at roadmap or ideation altitude, the step 3
   session note; at feature altitude, `nahel roadmap map show <ref>` and
   `nahel validate` — leave the map readable for whoever (or whatever)
   opens the next briefing.

Fallback (degraded environment): if the `nahel` CLI is unavailable, the
conversation may proceed — but make NO node, map, ticket, or journal
mutations; report every decision, graduation, and delegation reached so a
CLI-equipped session can record them. An unrecorded planning session is a
session the next one repeats.
