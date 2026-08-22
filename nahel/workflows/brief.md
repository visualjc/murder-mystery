---
name: brief
description: Onboard onto this project — render the nahel brief and act on it
args: ""
---

# Workflow: brief

Load and follow this workflow to onboard onto the project from zero context.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` (example: `NAHEL_ACTOR=agent:claude-code`) in
your environment so every journal event carries your identity and claim
enforcement applies to you. Humans rely on the config actor default.

1. Run `nahel brief` at the repo root. It renders the deterministic onboarding
   pack: the constitution's Goal and Hard constraints (verbatim), where
   canonical truth lives for each state layer, the work-item tree, recent
   journal activity, pending human decisions, and validate warnings.
2. Read every section. The constitution extract is binding: do not act against
   the Goal or any Hard constraint.
3. Orient on the state: `nahel status` for the full item tree,
   `nahel progress` for the full timeline when the brief's activity section is
   truncated.
4. Resolve the next action from the brief: prefer unblocking pending human
   decisions you are able to resolve, then the in-progress item, then the
   highest-value backlog item. If validate warnings exist, address them first
   (`nahel validate` for details).
5. Advance state only through the CLI (`nahel item`, `nahel run`, `nahel log`)
   — never hand-edit files under `nahel/`.

Fallback (degraded environment): if the `nahel` CLI is unavailable, read
`PRODUCT.md` (constitution), `CONTEXT.md` (glossary), and `nahel/items/*.md`
directly, and make no state mutations until the CLI is available again.
