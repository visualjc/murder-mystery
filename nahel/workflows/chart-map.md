---
name: chart-map
description: Chart a foggy effort as a wayfinder map — a destination, decision tickets, and the fog you have not cut yet
args: "<node-slug-or-id>"
---

# Workflow: chart-map

Load and follow this workflow to chart a **map** on a roadmap node — usually
a feature or an initiative whose shape is still foggy. A map shows five
sections: **Destination**, **Notes**, **Decisions so far**, **Not yet
specified** (the fog), and **Out of scope**. Every one of them moves through
the CLI; never hand-edit anything under `nahel/`.

**Decisions so far is not a section you write.** It is derived from the map's
resolved tickets, and the Out-of-scope lines a ticket earned are derived from
its closed ones — the record itself stores only what you chart here with no
ticket behind it. That is why the steps below rule things out of scope but
never record a decision: a decision is a ticket's act.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

Two rules hold throughout, and they are what make charting safe to start
early. **Nothing here is refused**: blocking edges are advisory, a claimed
ticket freezes nothing, and build may start before the map is finished.
**Everything is recoverable**: each act is one journaled CLI mutation, so an
interrupted session leaves state `nahel validate --repair` rolls forward.

1. Read what already exists. A node may be charted once, so start by looking:

       nahel roadmap <node-slug>
       nahel roadmap map show <node-slug>

   If a map is already there, this is a re-chart: skip to step 3 and add to
   it. `map show` also lists the tickets, with their state and their edges.

2. Name the destination — one sentence saying where this effort is going,
   written so a fresh agent could tell whether it has arrived:

       nahel roadmap map new --node <node-slug> \
         --destination "<where this is going>" \
         --notes "<what you already know: constraints, prior art, stakes>"

   A vague destination is the most expensive mistake on this page. "Better
   deploys" is not one; "a deploy a fresh agent can drive with no tribal
   knowledge" is.

3. Grill the map **breadth first**. Walk the whole destination once, naming
   every open question at the same depth, before going deep on any of them.
   Use the pinned `grilling` skill when installed; without it, the posture is
   the fallback: ask what would have to be true, name every branch, and never
   answer for the human. Depth-first charting produces a beautifully
   specified corner of a map you have not seen yet.

4. Cut each sharp question into a **decision ticket**. The type picks the
   surface that will answer it — choose deliberately:

   - `research` — the answer exists somewhere; go find it.
   - `prototype` — nobody knows; build a throwaway and look.
   - `grilling` — only the human can decide; interview them.
   - `task` — the answer is known; someone just has to do it.

         nahel roadmap ticket new --map <node-slug> --type <type> \
           --question "<the one thing this ticket exists to answer>"

   One question per ticket. A ticket asking two things resolves into a
   decision that answers neither cleanly.

5. Wire the blocking edges in a **second pass**, once every ticket has an id
   (wiring as you create means naming ids that do not exist yet):

       nahel roadmap ticket update <ticket-id> --blocked-by <ticket-id> --blocked-by <ticket-id>

   Blocking is **advisory** — it orders the frontier, it refuses nothing.
   Wire an edge only where the answer genuinely depends on the other answer,
   not where you merely prefer an order.

6. Sketch the fog: the in-scope questions that are real but not yet sharp
   enough to ticket. Fog is honest, not a failure — it is what you will
   graduate later.

       nahel roadmap map update <node-slug> --fog "<a question still out of focus>" --fog "<another>"

   `--fog` replaces the whole section, so pass every line you want kept.

7. Rule things **out of scope**, with the reason. This is the section that
   keeps the map from growing without bound; entries never graduate back:

       nahel roadmap map update <node-slug> --out-of-scope "<what is beyond the destination, and why>"

   `--out-of-scope` replaces the CHARTED lines, the same way `--fog` does, so
   pass every line you want kept. It cannot drop a line a ticket earned:
   those are derived from the closed tickets and were never in this list.

8. Confirm the chart, and leave it readable:

       nahel roadmap map show <node-slug>
       nahel validate

   Then journal the act so the next session sees why the map looks like this:

       nahel log note --data summary="charted <node-slug>: <n> tickets, <n> fog lines"

Work the map with `nahel/workflows/work-map.md`. Do not resolve tickets
here — charting and deciding are different sessions, and a chart written by
the same breath that answers it tends to ask only the questions it already
knew.

Fallback (degraded environment): if the `nahel` CLI is unavailable, the
grilling itself may proceed — but make NO map, ticket, or journal mutations;
report the destination, the questions and the fog you produced so a
CLI-equipped session can record them. If the `grilling` skill is not
installed, step 3's inline posture is its fallback.
