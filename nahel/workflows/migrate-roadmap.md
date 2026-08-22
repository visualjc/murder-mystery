---
name: migrate-roadmap
description: Adopt a store's existing work into the roadmap layer — journal the selected set, then create the nodes it names
args: "<product-node-slug>"
---

# Workflow: migrate-roadmap

Load and follow this workflow **once per store**, to give a store that has
work items but no roadmap its first one. Nothing here invents intent: the
roadmap layer starts by adopting the intent the store is already carrying.
After this runs, new intent is charted one node at a time with the ordinary
`roadmap node` verb — there is never a second migration.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

Three rules hold throughout.

**Coverage, not a count.** *Every* roadmap-shaped item in the store at
migration time gets a node. There is no target number: a migration that
produced "about eight nodes" has counted, not covered.

**The selection is a judgment, and the CLI never judges** (HC1) — it derives
and renders. Deciding which items are roadmap-shaped is the
**migrating agent's** call, which is exactly why step 3 writes the whole call
down before step 5 acts on it.

**Migration writes node records only.** The node names the item it covers and
nothing is ever written back onto the item; never hand-edit anything under
`nahel/`.

1. Enumerate the candidates **from the store**:

       nahel status

   Every line is `<name>  <type>  <status>  lane=<lane>  id=<id>`, and the
   tree is rendered by depth: the **least-indented** lines are the
   **top-level** items — the ones with **no parent**.

   Your candidate set is every top-level item whose status is not `dropped`:
   `backlog`, `in-progress`, `blocked`, `in-review`, **and `done`**.

   Two halves of that line, and both are deliberate. **Top-level** is the
   candidate boundary because a child item is a piece of work *under* the
   feature that earns the node — the parent is what the roadmap carries. And
   **`done` is in** because the roadmap's job is built / in-flight / planned,
   not planned alone: a product whose features have shipped would otherwise
   migrate to an empty roadmap and come out historyless. A done feature's node
   needs nothing extra to say so — its columns **derive** `built` from the
   epic it names, by the childless-epic rule or by its children's rollup.
   Only `dropped` is out: abandoned intent is not intent the roadmap carries.

   Do **not** start from `docs/roadmap.md`, from a PRD's list, or from a
   previous session's notes. Those are a **snapshot** of the day they were
   written, and the gap between such a list and the store is the whole reason
   this step names a command instead of a document.

   **What shipped before this store existed is not migration's business.**
   Migration adopts the intent the *store* is carrying, and a capability
   delivered before there was a store to record it carries no work item at
   all. A node charted for one would name no epic, so every column it renders
   would derive `planned` while the node claimed shipped history —
   **false history**, written by the act that exists to make history
   auditable. The honest answer is to leave it out and say so: bringing pre-store
   capabilities in is a **historical import**, designed separately, and it
   waits for that design rather than for a judgment call here.

2. Judge each candidate. **Roadmap-shaped** means the item states *product
   intent*: a capability of the product someone outside the codebase would
   notice, which the roadmap still carries after the work is done.
   **Work-shaped** means it states a task — a defect, a chore, a refactor, or
   a piece of a feature that already exists.

   The item's `type` is evidence, not the answer. Common shapes:

   - a `feature` item stating a capability nobody has built yet — **include**,
     including the deliberately-future ones. A node whose horizon is `later`
     is still coverage; leaving it out because it is far off is a count.
   - a `done` `feature` item — **include**: the capability is built and the
     roadmap still carries it. Its horizon is `now`, and its columns say
     `built` on their own.
   - a `bug` item — **exclude**: a defect in shipped behaviour is work, not
     roadmap intent, however large it is.
   - a `chore` — **exclude**, same reason.

   Every candidate you excluded that a reasonable reviewer could have included
   is a **near-miss**, and it needs a **one-line reason**. The test is simple:
   if you had to think about it, it is a near-miss. Excluding something in
   silence is the failure this step exists to prevent — a reviewer can argue
   with a reason, but cannot see an omission.

3. Journal the selected set. This event is the **first** act of the migration:

       nahel log roadmap.migration-selected \
         --data included='["<item-id>","<item-id>","<item-id>"]' \
         --data excluded='[{"id":"<item-id>","reason":"<why this one is work, not roadmap intent>"}]'

   `included` is every id that gets a node; `excluded` is every near-miss with
   its reason. **Log both lists, always** — every entry a work-item id, and
   every near-miss an `{id, reason}` pair whose reason says something. If
   nothing was arguable, say so with `--data excluded='[]'`: the set is read
   strictly, and **silence** is not the statement an empty list makes. A
   malformed or missing list is a `nahel validate` error rather than a set
   quietly read as smaller than it was.

   Write it **before the first node exists**, and what proves the
   call was made rather than reverse-engineered is one comparison: this event's
   `ts` **strictly earlier** than every `roadmap.node-created` `ts`. A set
   logged after the nodes proves nothing — a reviewer can no longer tell the
   judgment from its result — and a set logged in the **same second** proves
   nothing either, so it fails the migration exactly as a late one does (step 6
   is where you check it, and why rendered order is not the check).

   So get it complete before you log it. Re-read step 1's output one last
   time; a set you have to correct afterwards is a set the first event got
   wrong, and that is what the journal will show.

   `nahel log` prints the id of the event it wrote — that line is your
   confirmation the set landed. **Keep that id**: every feature node you create
   in step 5 names it, and it is what `nahel validate` joins the set to its
   nodes by.

   **Do not batch this step and the node creations into one script** — and do
   not trust composition to take long enough either: two ordinary invocations
   share a second easily.

   **Wait until the clock has left the selection's second** before creating
   the first node. One deliberate pause, made on purpose, is the only thing
   that makes the ordering true rather than likely. Journal timestamps are
   second-precision and every CLI invocation writes its own segment, so two
   acts in the same second have **no provable order**. A same-second tie
   **fails the migration**, and cannot be repaired by an explanatory note —
   the ordering IS the audit trail, so a migration that cannot prove its own
   order has not been made. Step 6 accepts or fails it on exactly that test.

4. Create **or reuse** the product node — one per store. Look first:

       nahel roadmap

   If the store has none, create it:

       nahel roadmap node new product <product-node-slug> --horizon now \
         --intent "<what this product is, a paragraph — not a PRD>" \
         --design-doc <repo-relative path to the product design doc>

   The design doc is the permanent statement of what the product is (in
   nahel's own store, `docs/roadmap.md`). Product design docs are updated in
   place forever; unlike a PRD, none is ever archived.

   **If a product node already exists, reuse it** — left by an attempt that was
   interrupted after this step, or charted at any other time — and confirm or
   adjust its intent in place:

       nahel roadmap node update <product-node-slug> \
         --intent "<what this product is, restated>"

   **Never create a second.** The product node is a store SINGLETON carrying
   stable intent: it belongs to the store, not to any one migration attempt, so
   it survives a retirement untouched and the next attempt inherits it. (Slugs
   are unique per store, so a second one is refused outright anyway — the same
   rule arriving as an error.)

   The product node takes **no `--migration`**: it covers no work item, so
   attributing it to the selected set would claim coverage it cannot deliver.
   That is also why it outlives a supersession — see step 6.

5. Create one feature node per **included** id — every id in the set, and no
   id the set does not name:

       nahel roadmap node new feature <slug> --horizon <now|next|later> \
         --parent <product-node-slug> --epic <item-id> \
         --migration <selection-event-id> \
         --intent "<the roadmap-level statement of this feature>"

   `--epic` records the item this node covers. The reference is **one-way**
   and canonical — it lives on the node, and no work-item record is written at
   all. Reuse the item's own name as the slug where it already reads as one,
   so a reader can trace node and item without a lookup. The horizon is a
   judgment like the selection: `now` for what is being worked (and for what
   is already built), `later` for the deliberately-future ones you still
   covered.

   `--migration` names the step 3 event this node is being created FOR — the
   **attribution**, and the whole reason step 6 can be a command instead of two
   lists read side by side. Pass it on every feature node of this migration and
   on nothing else: ordinary charting, later, omits it, and that omission is
   exactly what keeps a node charted next month out of this migration's audit.

   Attributing a node to a **retired attempt** — one already superseded, see
   step 6 — is refused. Such a node would belong to no live migration, and
   nothing would audit it: a retired attempt owes no coverage, and the audit
   reads the active one. After a supersession, journal a fresh selected set and
   attribute to that.

6. Check the coverage in both directions — either one alone passes a broken
   migration:

       nahel roadmap
       nahel roadmap node show <slug>

   Every included id must have a node (`epic=<item-id>` on the node is the
   trace back), and every node must name an included id — **no orphan** node,
   and **nothing invented** that the logged set never selected. If the two
   disagree, the nodes are what you fix; the set is already journaled.

   Because step 5 attributed every node, the same comparison is also a command:

       nahel validate

   The `roadmap.migration-audit` check joins the selected set to the nodes
   attributed to it and reports both directions as **errors** — an included id
   with no node, a node covering an id the set excluded or never listed, two
   nodes for one id, and a node whose creation did not strictly follow the
   selection. It ignores unattributed nodes entirely. One shape is a
   **warning** rather than an error: a selection with no attributed node at
   all, which is either a migration mid-flight (you are between step 3 and
   step 5) or one made before attribution existed. A finished migration of
   that older shape is history, not a defect, and is never re-run to satisfy
   the checker.

   Then accept — or fail — the migration on the one comparison step 3 named:

       nahel progress

   The rendered position is the **quick look**: your
   `roadmap.migration-selected` line should sit **above every**
   `roadmap.node-created` line. It is not the acceptance. A same-second tie
   breaks on the random event id, so the wrong order renders as the right one
   about half the time, and an eyeballed timeline would pass it.

   The acceptance is **strict timestamp inequality**: read the leading `ts` of
   the selection line, then the leading `ts` of every `roadmap.node-created`
   line, and each of those must be **strictly later**. Equal timestamps are a
   same-second tie, and a same-second tie **fails the migration** — it
   cannot be repaired by an explanatory note.

   A failed migration is **retired, not reverted**. **Converge the store
   first** — every retirement below starts here:

       nahel validate --repair

   A migration that failed was very likely interrupted, and an interrupted
   write leaves the journal ahead of the records. `supersede` refuses while any
   roadmap node record is still behind the event that records it, and names
   what is pending. The reason: a retirement is computed from the journal and
   the disk *together* — which nodes the attempt is attributed, and what exists
   and still links to them — so a record nobody has materialized yet is in
   neither answer. Retiring around it scopes the act to a store that does not
   exist yet, and the repair you run afterwards would materialize that record
   on top of whatever the retry had charted in the meantime. Repair first and
   it is simply there: visible to you, and to step 4's create-or-reuse.

   (This is about divergence the store was *already* carrying. The
   supersession's own steps are write-ahead like every other act, so an
   interruption *inside* one is healed by the same `nahel validate --repair`.)

   Then retire the attempt:

       nahel roadmap migration supersede <selection-event-id> --reason "<what went wrong>"

   That journals the retirement beside the attempt and moves every node the
   attempt created under `nahel/roadmap/failed/<selection-event-id>/`, where
   nothing renders it. The journal keeps the whole story — the set, the nodes,
   and why they were retired — because a store that quietly loses its failed
   attempt is a store whose successful one cannot be trusted either. Do **not**
   reach for `git revert`: a `git` history is not this store's history.

   The verb refuses if any node or map charted since points at one of those
   records, naming what points where; re-point or remove those first. After a
   supersession the store has **no active migration**, and exactly one fresh
   selection may follow — start again at step 1, enumerating the store as it
   is now.

   **An attempt interrupted before its first feature node** is retired the same
   way — repair first, exactly as above — with one extra word:

       nahel validate --repair
       nahel roadmap migration supersede <selection-event-id> \
         --reason "<what went wrong>" --nothing-to-move

   Steps 3 and 4 create nothing attributed — the set is an event, and the
   product node covers no work item — so an attempt killed in there has no
   record to move, and what supersession retires is its **authority**: the
   store gets its next migration back. `--nothing-to-move` is the
   acknowledgement that no record will move, and it is required because the
   identical state is what a **finished** migration made before attribution
   existed looks like, and that one must not be retired by anyone reading
   "supersede" as "undo". The verb prints what it retired, that zero records
   moved, and — as a warning to read before re-migrating — any live node still
   covering an id the retired set named.

   The product node, if step 4 got that far, **stays**. It is the store's, not
   the attempt's, so the retry reuses it at step 4 rather than creating a
   second. That is exactly why the repair comes first: a product node whose
   creation was interrupted is a node the retirement cannot see and the retry
   would duplicate — repaired, it is just the product node the store already
   has.

7. Prove the direction, then leave the store clean:

       git diff --stat -- nahel/items/
       nahel validate

   `git diff` over `nahel/items/` must print **nothing**. A single modified
   item record means the migration went the wrong way — the roadmap points at
   work items, never the reverse — and that is a bug to undo, not a diff to
   commit.

   Then journal the act, so the next session reads why the tree looks like
   this without replaying the whole migration:

       nahel log note --data summary="migrated <store>: <n> feature nodes under <product-node-slug>, <n> near-misses excluded"

Fallback (degraded environment): if the `nahel` CLI is unavailable, the
judgment may proceed — but make NO node or journal mutations; report the
selected set and every near-miss with its reason so a CLI-equipped session can
record them in that order. A selection nobody journaled is a migration nobody
can audit, which is the one thing this workflow exists to prevent.
