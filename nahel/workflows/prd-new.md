---
name: prd-new
description: Author a PRD through a grilling interview and record it as the plan item's deliverable
args: "<slug>"
---

# Workflow: prd-new

Load and follow this workflow to author a PRD. A PRD is a knowledge
document, not state: it lives in `docs/prds/`, and its draft→approved
lifecycle lives exclusively on the plan work item that authors it
(ADR-0013) — the PRD file itself never carries a status field. The
interview and the writing are judgment work; every state mutation goes
through the CLI. Never hand-edit anything under `nahel/`.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

1. Own the work. Find the `plan` item this PRD belongs to (`nahel status`),
   or create one, then start it:

       nahel item new plan <slug> direct
       nahel item update <id> --status in-progress

   The slug names the document: `docs/prds/<slug>.md`.

2. Pick the path. Check whether the feature's roadmap node has a charted
   map (`nahel roadmap map show <node-slug>`). A charted map means the
   map GOVERNS — the PRD starts from it (step 2a), even when nothing is
   resolved yet: zero resolved tickets just means the cut check has more
   to resolve, and the interviewing happens INSIDE the map, each answer
   recorded as a ticket resolution rather than as loose prose. Only a
   node with no map at all takes the from-scratch interview (step 2b).

   2a. **Map-fed path.** The map's resolved decisions become the PRD's
   settled sections — each stating the decision and CITING its ticket id,
   never re-arguing it (`nahel recall` reaches the rationale; the PRD
   points, the tickets hold). Then run the CUT CHECK and record it in the
   PRD: walk every remaining fog line and open ticket and sort each into
   two piles —
   - **outside this delta**: not needed for the slice being shipped; it
     stays on the map, keeps resolving, and sharpens into a successor
     node (`--predecessor` linked) later. It never enters the PRD.
   - **inside this delta**: the slice cannot be built without deciding
     it. Three doors, and the human picks per question: **resolve now**
     (a quick grill, or wait for in-flight research), **re-cut the delta
     smaller** so the question falls outside, or **delegate** — the human
     names the tickets and says "use your default recommendations"; the
     workflow journals a delegation note naming them, and each consequent
     resolution is made by the agent with its stated default and
     rationale, citing that note via `--source`. Human-only tickets are
     never delegable — the CLI refuses regardless.

   Under the map-fed path the PRD's open-questions section is empty BY
   CONSTRUCTION: an inside-delta question resolves during writing or
   forces a smaller cut; an outside-delta question stays on the map. A
   map-fed PRD with a load-bearing open question is a cut check that was
   not run.

   2b. **From-scratch interview** — grill, don't transcribe. Use the
   pinned grilling skill when
   installed; without it, apply its core inline: ONE question at a time,
   never compound, follow up on every vague answer until it is concrete
   enough to refuse work with, and stop only when you could defend the plan
   to a skeptic. Cover, in order:
   - **Goal** — the problem and why now; one paragraph the human signs off on.
   - **Non-goals** — what is explicitly NOT being built. An empty list means
     the interview is not finished.
   - **Functional requirements** — each with acceptance criteria a test
     could check. A requirement without a provable "done" needs more
     interview.
   - **Exit test** — the end-to-end proof the whole feature works.
   - **Open questions** — only genuinely open ones. A question the interview
     could have answered is an interview failure, not an open question.

3. Write `docs/prds/<slug>.md`. Frontmatter carries exactly `name`,
   `created`, and `updated` — NO status field (ADR-0013). Timestamps come
   from the system, never estimated:

       date -u +"%Y-%m-%dT%H:%M:%SZ"

   Body: goal, non-goals, functional requirements with acceptance criteria,
   exit test, open questions. No placeholder text anywhere — an empty
   section means the interview resumes. The one exception: under the
   map-fed path (2a), open questions is empty by construction, and a
   map-fed PRD states which tickets its settled sections cite.

4. Record the deliverable on the plan item and hand it to the human:

       nahel item update <id> --prd docs/prds/<slug>.md
       nahel item update <id> --status in-review

5. STOP at the gate. Approval is recorded as the plan item's status flip to
   `done`, through the CLI — and WHOSE word grants it is the project's
   `governance.product` setting, which `nahel brief` renders under
   "governance & merge authority":

   - **`human`** — the flip is the human's decision, at their explicit word.
     Nothing about this step changes.
   - **`delegated`** (also how a project that declared no governance behaves)
     — a plan item's approval may instead be granted by the
     cross-vendor consensus `nahel/workflows/afk-run.md` step 6 defines:
     a proposal, an independent verification by another vendor, and a
     decision event linking the two. That procedure lives there and only
     there — never improvise a shorter one here. This workflow still stops
     regardless: an interview-authored PRD has a human in the room.

   The exception covers PLAN-ITEM approval and nothing else:
   leaf-item `done` stays human-only (task-lifecycle, bug-lane), and
   constitution amendments are never delegable under either setting.

   Auditing a delegated approval means reading three events back
   (`nahel progress --item <id>`): the proposal, summarized
   "PRD proposed for delegated approval" and carrying `revision` and
   `assumptions`; the verification under ANOTHER vendor's actor, carrying
   `verifies` and `verdict`; and the decision, summarized
   "delegated approval (governance.product=delegated)", whose
   `proposal` and `verification` name both. A `done` an agent flipped
   without that trail is not an approval.

   Do not parse the PRD into feature items; that is the prd-parse workflow,
   and it waits for the flip.

Fallback (degraded environment): if the `nahel` CLI is unavailable, hold
the interview and draft the PRD anyway — it is a knowledge document, not
CLI-maintained state — but make NO item mutations; record which mutations
remain so a CLI-equipped session can finish. If the grilling skill is not
installed, the inline posture in step 2 is its fallback: the interview
happens at full strength regardless.
