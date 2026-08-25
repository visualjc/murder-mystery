---
name: inception
description: Found a project — knowledge-first mining, then a confirm-and-correct interview (guided) or a single paragraph (hands-off), producing constitution, governance, glossary, ADRs, routing, run contract, and first work items
args: "[seed|standard]"
---

# Workflow: inception

Load and follow this workflow to found a project on nahel, or to re-found one
whose recorded tier no longer covers what it is asked to do. Inception is
judgment work: you mine, you draft, and the human decides; the CLI does every
state mutation. Never hand-edit anything under `nahel/`.

Knowledge-first is the posture throughout: you draft from every source
available BEFORE the human is asked anything about the project — on every kind
of repo, in either mode. A blank-page question is a failure of preparation.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

## Step 0 — Mode and input capture

The first thing you ask, before mining and before any question about the
project itself. It is a meta-question — how this founding RUNS, not what the
project IS:

> Grill session (guided), or
> give me a paragraph and I figure it out (hands-off)?

Asking is free; recording is not. On a repo with no `nahel/` yet there is
no store to record anything INTO — no config section, no work item, no journal
event, not even the research note the mining below wants — so scaffolding is
unconditionally the first mechanical act, in BOTH modes:

    nahel init

The meta-question above may be asked before it; nothing is RECORDED until the
store exists. (Hands-off on a bare repo has a shortcut that scaffolds and
records the paragraph in one act — take that one instead, below.) On an
already-initialized repo the store is there and this step is already done.

Guided and hands-off are two interaction modes of THIS workflow: there is
no separate mining workflow, and no separate hands-off procedure. Same mining,
same complete draft set, same tier steps. The mode decides only who answers
the questions the drafts raise — and, under hands-off, what those answers are
worth (see "Hands-off founding" below).

Record the answer; the mode is state, not a memory of a chat.

- Hands-off on a repo with no `nahel/` yet — the HUMAN runs this one command,
  and that single act is the whole of their attention. It
  scaffolds and records together, so it IS the `nahel init` above rather than
  a step after it — run bare-repo hands-off through this door, never a plain
  `nahel init` followed by a paragraph with nowhere to land:

      nahel init --hands-off "<the paragraph, verbatim>"

- Hands-off on an already-initialized repo — the same state through the
  conversational door (hard constraint 5), also run by the HUMAN:

      nahel config set founding \
        --data mode=hands-off --data paragraph="<the paragraph, verbatim>"

  The `--data key=value` dialect trims each entry's outer whitespace. When a
  paragraph's leading or trailing whitespace is load-bearing, pass the section
  as JSON (`--data '{"mode": "hands-off", "paragraph": "…"}'`), or use the
  `init` flag, which never touches the text.

- Guided — the store exists by now (the scaffold above, or an already
  initialized repo), so the mode can be recorded; do it, so the trail shows
  which door the founding came through:

      nahel config set founding --data mode=guided

Only the hands-off paragraph carries authority, so only its act's actor is
load-bearing: the human-attributed `config.updated` act that wrote the
`founding` section IS the paragraph's signature. An agent-run founding act
signs nothing — record the paragraph if the human dictated it to you, then say
plainly that the founding stays unsigned until they run the command
themselves. `nahel validate` enforces this mechanically (`founding.unsigned`,
warning): it fires when the paragraph's latest founding act is agent-run, when
the act's recorded paragraph no longer matches the committed bytes (the text
moved after signing — re-sign through the byte-preserving JSON `--data` form),
or when same-second acts disagree on actor, mode, or paragraph and the
signature is ambiguous; only a journal with no founding act at all reads as
unrecorded. The guided-mode analogue is `inception.unsigned` (also warning):
it fires on a store whose inception section is absent despite recorded work,
lacks `constitution_signed_by`, had the section written by an agent, or holds
a signer or mode hand-edited after its recording act.

## Pick the tier

- `seed` (~5 minutes): quick prototype ideas — the minimum grounding for
  honest interactive work.
- `standard`: seed at full depth, plus ADRs, routing, a doctor-proven run
  contract, and an initial decomposition — the bar for delegating anything.
- `full`: deferred — its procedure does not ship yet. If asked for it, run
  `standard` and say so; never record a tier whose work was not done.

The argument, if given, names the tier; otherwise ask. The tier is recorded
as the LAST step of its section — recording is a claim the work above it
happened.

## Mine first — every founding, before any content question

MINE FIRST, interview second. Universal now, not a brownfield special case:

- **Brownfield** — the repo already has code: mine the code, the README, the
  existing docs, and the git history.
- **Greenfield** — an empty repo, or an idea: mine your own domain knowledge
  and the web where the host has it. Journal what you actually consulted, so
  the mining is provable rather than merely claimed:

      nahel log note --data summary="research sources: <what you read — urls, works, standards — and what each settled>"

  Where there is no web access, journal that instead; a stated gap beats a
  silent one:

      nahel log note --data summary="research sources: web unavailable on this host — drafted from domain knowledge alone"

Then draft the complete standard-tier artifact set BEFORE the first content
question: the constitution (goal, domain facts, hard constraints, non-goals),
the governance posture, the glossary seed, the founding ADRs, the routing map,
an actionable initial decomposition, and the run contract. Wrong guesses are
fine — they surface the truth faster than empty prompts.

Then journal the DRAFT MANIFEST, in one event, before the first interview
response (and, under hands-off, before the verification dispatches). The bar
is that the COMPLETE draft set existed before the human said anything about
the project — and "I drafted first" is not provable from prose. Write each
draft to its real path, hash them, and record path + hash for every one:

    for path in $(printf '%s\n' PRODUCT.md CONTEXT.md docs/adr/*.md | sort); do
      printf '%s  %s\n' "$(git hash-object "$path")" "$path"
    done

    nahel log note \
      --data summary="draft manifest: complete artifact set drafted before the first interview response" \
      --data manifest='[{"path": "PRODUCT.md", "hash": "<hash>"}, ...]'

A draft you have not written to a path yet — a routing map, a contract stub, a
decomposition still in your session — is hashed the same way from its exact
text (`printf '%s' "<the draft>" | git hash-object --stdin`), so the manifest
is one mechanism and every entry is checkable.

This event is DRAFTING and never sign-off. The signature stays the human's own
`nahel config set inception` act (step 8, or step 13 at standard tier); no
manifest note substitutes for it, and none ever records a tier. What the
manifest proves is the ORDER — drafts first, answers second — which is the
whole claim a confirm-and-correct interview makes.

The interview is then confirm-and-correct, always: the human reads concrete
drafts and corrects them, rather than answering blank questions. Aim for
minutes of their attention, not hours.

A draft is not a founding. Drafts live in your session; the project is founded
only by the recorded state the tier steps below write.

## Seed tier (~5 minutes)

1. The store is already scaffolded — step 0 ran `nahel init` (or
   `nahel init --hands-off`) before anything was recorded. Resuming into a
   repo that still has no `nahel/`? Run `nahel init` now, before any command
   below; it is scaffold only, and this workflow fills what it stubs.
2. Constitution: put the drafted goal, hard constraints, and non-goals in
   front of the human and correct them together — grill until each is concrete
   enough to refuse work with. Write them into the constitution document
   (config `knowledge.product`, PRODUCT.md by convention). The constitution is
   the human's: read it back and get explicit sign-off. That sign-off is
   RECORDED, not remembered — it is written with the tier (step 8, or step 13
   at standard tier), and the HUMAN runs that command themselves. An
   agent-attributed signature gates nothing: the autonomy gate reads the actor
   of the act that wrote it. Under a hands-off founding there is no interview
   and the signed content is the paragraph alone — read "Hands-off founding"
   before writing a line of the document.
3. Governance: ask who owns product and architecture legislation — `human`
   (agents propose, the human approves) or `delegated` (agent consensus:
   cross-vendor approval, journaled). The written default is
   `{product: delegated, architecture: human}`, and it matches what a project
   with NO governance config does: pushing forward is the default unless the
   human says otherwise. `governance.product: human` is the explicit brake —
   choose it when the human wants to approve every PRD personally, and expect
   Full-lane items to park at that gate. Architecture stays `human` until the
   architect slice ships. Record the answer explicitly, so the posture is
   state rather than an inferred default:

       nahel config set governance \
         --data product=delegated --data architecture=human

4. Merge authority: ask who merges a reviewed PR — `human` (the default
   everywhere: the PR waits for a person) or `on-approve` (reviewer sign-off
   merges). `on-approve` is an opt-in to use SPARINGLY —
   small items, or changes QA testing covers well; when the founder shrugs,
   the answer is `human`. Record it explicitly, so the authority is state
   rather than an inferred default:

       nahel config set merge --data authority=<human|on-approve>

   For `on-approve` the HUMAN runs that command themselves: the committed
   flip IS their standing authorization, so an agent-run set authorizes
   nothing — `nahel brief` renders it inert, the review loop behaves as
   `merge: human`, and `nahel validate` warns (`merge.unauthorized`).

5. Glossary seed: put the domain terms the mining and the interview surfaced
   (aim for 3–10) into the glossary document (config `knowledge.context`,
   CONTEXT.md by convention) — exact meanings, not prose.
6. Run contract stub: how does the app launch, seed, and test? Best-known
   commands are fine at seed tier — `nahel doctor` proves them later, and a
   wrong stub found by doctor beats no stub at all:

       nahel config set contract \
         --data launch="<command>" --data seed="<command>" --data test="<command>"

7. First work: capture what founding surfaced as at least one `plan` item —
   backlog truth beats memory:

       nahel item new plan <slug> direct

8. Record the tier — and the constitution signature with it. Both go
   in the SAME command: `config set` replaces the whole section, so a later
   tier write that omits the signature erases it. The human runs this
   themselves; their actor on the journaled act is what the autonomy gate
   reads:

       nahel config set inception \
         --data tier=seed --data constitution_signed_by=<the human's id>

## Standard tier

Steps 1–7 at full depth (constitution grilled hard, contract complete, no
stubs), then:

9. ADR seeding: record each founding architecture decision — context,
   decision, consequences, one document per decision — under the config
   `knowledge.adr` directory, numbered sequentially.
10. Routing: run the setup-routing workflow (`nahel/workflows/setup-routing.md`)
    to detect the available agent CLIs and write the responsibility map.
11. Run contract, proven: complete launch/seed/test plus healthcheck, ports,
    and required env var NAMES (values stay in gitignored env files, never in
    state), then prove it — `nahel doctor` must exit 0 on this machine. An
    empty repo has nothing to prove yet: record the contract anyway and
    journal the deferred proof as an obligation ("Tier honesty" below).
12. Initial decomposition: turn the goal into first real work items with
    `parent`/`depends_on` edges (`nahel item new`, `nahel item update`) so
    the backlog is actionable, not one vague item.
13. Record the tier and the signature together, as in step 8 — the human runs
    it:

        nahel config set inception \
          --data tier=standard --data constitution_signed_by=<the human's id>

## Hands-off founding (zero return visits)

The human handed over a paragraph and left. Everything above still applies —
the same mining, the same complete artifact set, the same tier steps — with
the interview replaced by your own drafting and no return visit: ask nothing
after the founding act. Anything you cannot decide parks (a `blocked` item
with a journaled reason, `nahel/workflows/afk-run.md` step 12); it never waits
for a turn.

### The authority boundary

The paragraph is the constitution's only human-signed content, and it goes in
VERBATIM — reproduced word for word, never paraphrased, tightened, corrected,
or "improved". What you write around it is never constitutional text, however
well drafted. Make the boundary visible in the document itself:

    ## Goal

    > <the founding paragraph, verbatim>

    The quoted paragraph is the human's signed content, and the only signed
    content in this document (recorded as `founding.paragraph` in
    `nahel/config`).

    ## Domain facts

    UNCONFIRMED — drafted by an agent from the paragraph; not human-signed.

    - <domain fact>

    ## Hard constraints

    UNCONFIRMED — drafted by an agent from the paragraph; not human-signed.

    1. <constraint>

    ## Non-goals

    UNCONFIRMED — drafted by an agent from the paragraph; not human-signed.

    - <non-goal>

    Amendment note (hands-off founding): only the quoted paragraph is
    human-signed. Everything else in this document is agent elaboration —
    AFK work may rely on it as a parkable assumption, never as an
    un-overridable rule, and the human promotes any of it into the
    constitution later by signing it. See
    `docs/adr/0008-constitution-vs-legislation.md`.

Keep the `## Goal` and `## Hard constraints` headings exactly as the template
writes them — `nahel brief` extracts those two sections verbatim — so the
UNCONFIRMED marking sits INSIDE the section body, never in the heading.

### Verify the elaboration

The elaboration is legislation-layer content, so it is verified the way
delegated legislation is verified. Use the provenance shape of
`nahel/workflows/afk-run.md` step 6 — never invent a second one — bound to the
founded artifact set instead of to a PRD.

**Order first.** `nahel dispatch` requires `--item`, so a verification
dispatched before an item exists is refused outright and the elaboration never
gets verified at all. The item is the founding's own first plan item — part of
the artifact set already (step 7's first work, and at standard tier the
initial decomposition of step 12), so nothing new is invented here; it is
only CREATED BEFORE this section runs rather than after:

    nahel item new plan <founding-slug> direct

Keep that id: every event below rides it. The tier is still recorded last,
after the verification lands.

**One hash, over the complete set.** Bind the consensus to a single canonical
manifest — the documents, the config the founding wrote (governance, routing,
contract, the founding paragraph itself), and the decomposition it authorizes.
Loose per-file hashes leave everything outside the pile free to change under
the verification, which is exactly what "bound to the founded artifact set"
must not allow:

    for path in $(printf '%s\n' PRODUCT.md CONTEXT.md docs/adr/*.md \
                    nahel/config nahel/items/*.md | sort); do
      printf '%s  %s\n' "$(git hash-object "$path")" "$path"
    done > "${TMPDIR:-/tmp}/founding-manifest"

    git hash-object "${TMPDIR:-/tmp}/founding-manifest"

Sorted paths make it deterministic; `nahel/config` carries the governance,
routing and contract state; the item records carry the decomposition. Nothing
in the founded set moves without moving the manifest, and the manifest is
hashed once. That one `<manifest-hash>` is the revision on all three events —
the manifest is built outside the repo so it never hashes itself:

    nahel log note --item <plan-id> \
      --data summary="hands-off elaboration proposed for verification: <the artifacts>" \
      --data revision=<manifest-hash> \
      --data artifacts='["PRODUCT.md", "CONTEXT.md", "docs/adr/…", "nahel/config", "nahel/items/…"]' \
      --data assumptions='["<assumption-event-id>", ...]'

Write the verification brief to a file, then dispatch a pointer to it — task
context travels through the run-dir handoff document (dispatch copies the
brief to `nahel/runs/<run-id>/task.md`, spawns a bounded pointer prompt, and
journals the path, never the content); never inline a brief this size after
`--`, an oversized argv hangs vendor CLIs:

    nahel dispatch review --item <plan-id> --task-file <verification-brief-path>

The brief says: "Verify the hands-off elaboration at manifest revision
<manifest-hash>, independently. Read the signed founding paragraph
(nahel/config, founding.paragraph), the drafted artifacts the proposal lists,
and the assumption events cited by proposal event <proposal-event-id>.
Rebuild the manifest yourself from those paths and check the hash before
judging anything. Judge whether any elaborated domain fact, hard constraint,
or non-goal contradicts the paragraph, whether the recorded governance,
routing, contract and decomposition follow from it, and whether each
assumption is safe to build on. Journal your verdict yourself, under your own
actor: nahel log note --item <plan-id> --data summary='hands-off elaboration
verification: <agree|disagree> — <what you checked and what you found>'
--data revision=<manifest-hash> --data verifies=<proposal-event-id>
--data verdict=<agree|disagree>"

    nahel log note --item <plan-id> \
      --data summary="hands-off elaboration verified: proposed by <your actor>, verified by <verifier actor>" \
      --data revision=<manifest-hash> \
      --data proposal=<proposal-event-id> \
      --data verification=<verification-event-id>

Re-run the manifest recipe before recording that decision: a hash that moved
since the proposal means part of the founded set changed under the
verification, so the consensus does not cover what is on disk — treat it as
unverified. Recording the tier moves the hash deliberately, and comes after.

The verification goes to a DIFFERENT vendor — the routing map's `review` slot.
If that route resolves to your own vendor, consensus is impossible: park.
A verification you write yourself proves nothing. Journal every assumption the
interview would have settled first, one event each, or the verification has
nothing to check.

A verification that disagrees, never arrives, or lands against a revision that
has since moved leaves the founding at `seed` — or parked — never `standard`.
Consensus authorizes legislation-layer content only: it can neither sign the
paragraph nor amend it.

### When the paragraph is not enough

If no coherent goal or success criterion can be derived from the paragraph,
REFUSE to record `standard` and park it for the human:

    nahel item new plan founding-paragraph-insufficient direct
    nahel item update <item-id> --status blocked
    nahel log note --item <item-id> \
      --data summary="parked: the founding paragraph yields no coherent goal — <what is missing, and the question that would settle it>; hands-off founding cannot record standard"

Never invent the goal to get past this. An invented goal is agent-authored
constitution, which is exactly what the boundary forbids.

### Governance, and the check that never sleeps

A human who hands over a paragraph and leaves has delegated product
legislation. Record it — their founding act is what authorizes it:

    nahel config set governance \
      --data product=delegated --data architecture=human

The signed paragraph is then checked before every implementation dispatch,
on every lane — `nahel/workflows/afk-run.md` step 8. Not only at the Full-lane
approval gate: a Full-lane drafted PRD and a direct-lane one-liner get the
identical check, and work that would contradict the paragraph parks instead of
being dispatched. The one human instruction is the one thing
the run can never override, and your own elaboration — unconfirmed by
construction — can never authorize contradicting it.

### The signature, recorded

Record the tier and the signature as in step 13, naming the human whose
founding act carried the paragraph:

    nahel config set inception \
      --data tier=standard --data constitution_signed_by=<the human's id>

That command is yours to run in this mode (the human is gone) and it is
bookkeeping: the signature the autonomy gate trusts is the human-attributed
`config.updated` act on the `founding` section, deterministic to check —

    nahel progress | grep config.updated

An agent-run founding act signs nothing. If the paragraph was recorded under
an agent actor, the project is unsigned: say so plainly and leave the gate to
refuse.

## Tier honesty

`standard` means the complete artifact set is recorded, not drafted:
constitution signed, governance, glossary seed, founding ADRs, routing map, an
actionable decomposition, and the run contract. Drafts in a session founded
nothing.

One amendment, for empty repos: the run contract's proof cannot precede the
app it checks. A founding on an empty repo therefore records `standard` with
that proof DEFERRED as a journaled first-scaffold obligation:

    nahel log note --data summary="first-scaffold obligation: run contract unproven on an empty repo — nahel doctor must exit 0 before any verify-by-driving PR opens"

That journaled obligation is also what lets an honest greenfield START an AFK
run at all: `nahel/workflows/afk-run.md` gate 1b admits a doctor that fails on
env or healthcheck ONLY when this event is present (a missing contract still
refuses outright). The AFK run then discharges it:
`nahel/workflows/afk-run.md` step 9a requires `nahel doctor` to exit 0 before
it drives anything, and no PR opens without verify-by-driving evidence — so an undischarged obligation
blocks the PR rather than being forgiven. Journaled, not remembered.

Everything else stays honest the hard way:

- A NEW founding the human cut short, before the artifact set is complete,
  records `seed` — with the ratchet's consequences (no delegated approval, no
  prototype promotion) applying as usual.
- A hands-off founding whose elaboration verification failed, or whose
  paragraph is constitutionally insufficient, records `seed` or parks. Never
  `standard`.
- Re-founding never lowers a committed tier: a cut-short re-founding of a
  `standard` project leaves `standard` recorded.

## Tier ratchet

Stated now, enforced by later phases: graduating any governance area to
`delegated`, or promoting a prototype to a product, REQUIRES an inception
upgrade — re-run this workflow at `standard` (or `full` once it ships) and
record the new tier via `nahel config set inception` — carrying the
constitution signature through in that same command, or the ratchet erases it.
The tier only ratchets up; never record a lower tier than the committed one.
Interactive work needs no inception artifacts at all — the recorded tier, the
signature, and the run contract gate autonomy, nothing else.

Fallback (degraded environment): if the `nahel` CLI is unavailable, hold the
interview (or read the paragraph) and draft the knowledge documents
(constitution, glossary, ADRs), but make NO config or item mutations — those
are CLI-maintained state, and a hands-off paragraph recorded nowhere is no
signature at all. Record what remains undone so a CLI-equipped session can
finish founding.
