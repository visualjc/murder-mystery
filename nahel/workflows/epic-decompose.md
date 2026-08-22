---
name: epic-decompose
description: Decompose a parent feature item into dependency-ordered, session-sized child work items
args: "<feature-item-id>"
---

# Workflow: epic-decompose

Branch note: the epic's children share one branch — `epic/<parent-slug>` cut
from the default branch — and land together via one reviewed PR (see
task-lifecycle's git discipline).

Load and follow this workflow to break a parent feature item (an epic, in
the glossary sense: a work item with children) into child work items. The
judgment is the split; the mechanics are `nahel item new` with `--parent`
and `--depends-on`. Never hand-edit anything under `nahel/`.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

1. Ground yourself: read the parent item (`nahel status` shows its `prd`
   path) and the PRD it references, end to end, against the actual code.

2. Draft the split before creating anything, holding this discipline:
   - ONE child per coherent deliverable — no grab-bag items, no
     half-deliverables split across children.
   - No child bigger than one focused session; split further until that
     holds.
   - Every child independently verifiable: its acceptance is provable by a
     test or command on its own, never "the whole works".
   - Prefer few children — around ten is already a lot. Reuse existing code
     and surfaces before inventing new ones; a smaller plan that leans on
     what exists beats a thorough plan that rebuilds it.
   - Dependency edges ONLY where truly blocking. The `depends_on` graph
     must be a DAG that mirrors the real build order — `nahel validate`
     rejects cycles — and every edge you skip is parallelism you keep.

3. Create the children, each after the items it depends on:

       nahel item new <type> <slug> <lane> --parent <feature-id> [--depends-on <id>]...

   Type per child (`feature`, `chore`, `qa`, …) and lane per child — most
   children land `direct`. A child that itself needs decomposing is a sign
   the split is not finished; go back to step 2.

4. Sanity-check the shape: `nahel status` — children indented under the
   parent, every dependency edge one you would defend as truly blocking,
   every lane deliberate.

5. Journal the decomposition on the parent:

       nahel log note --item <feature-id> \
         --data summary="Decomposed into <n> children: <slugs, in build order>"

Fallback (degraded environment): if the `nahel` CLI is unavailable, draft
the decomposition — children, lanes, dependency edges — as notes for the
human, but create nothing: work items are CLI-maintained state. Record the
pending `item new` calls so a CLI-equipped session can perform them.
