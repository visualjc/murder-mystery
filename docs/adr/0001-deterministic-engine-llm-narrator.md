# ADR-0001 — Deterministic engine, LLM narrator

- **Status:** accepted (founding)
- **Date:** 2026-08-22
- **Provenance:** UNCONFIRMED — drafted by `agent:opus-founder` during a hands-off founding. Not human-signed.

## Context

The founding paragraph asks for an LLM that "acts like a game master" and
"move[s] the game forward". The tempting reading is to let the model hold the
game: give it the case file, let it adjudicate suggestions, let it decide who
refutes with what.

That reading fails on two counts. First, Clue is a closed-world deduction
puzzle — a model that hallucinates one refutation destroys the whole logical
chain a player has built, and the player has no way to detect it. Second, it
makes the game untestable: there is no assertion to write about a turn whose
outcome is a sampled token sequence.

The rules themselves are small and completely decidable: deal, legal move,
suggestion validity, clockwise refutation search, accusation check against a
hidden triple. Nothing in them needs a language model.

## Decision

Split the system in two, with the seam at authority:

- A **deterministic engine** owns all game state and every rule outcome. It
  holds the case file, deals hands, validates and applies moves, runs
  refutation in clockwise order, adjudicates accusations, and declares
  win/loss. It is pure logic over an explicit state value, with no network
  calls in it.
- The **LLM game master** receives engine-decided facts and produces prose:
  the scenario at setup, narration for each event, and in-fiction answers to
  player questions. It is told what happened. It never determines what
  happened.

No branch in the engine reads LLM output. Nothing is parsed out of model text
to drive state. The game is fully playable with the LLM stubbed out or failing.

## Consequences

- The engine is unit-testable without a network or an API key, and a scripted
  playthrough can assert exact outcomes.
- LLM failure degrades presentation only: on an error or empty reply, the
  engine's plain description of the event is shown and play continues.
- The game master cannot be given the case file — leaking it into a prompt
  would let narration spoil the puzzle. Prompts carry only what the receiving
  player is entitled to know.
- LLM-driven suspects making suggestions is a constrained case, not an
  exception: the model may propose, but the engine validates and can reject or
  substitute a legal action. A model's suggestion is an input, not an outcome.
- Some flavor is lost — the game master cannot invent rule twists mid-play.
  That is the point of the trade.
