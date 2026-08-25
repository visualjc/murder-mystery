# ADR-0003 — CLI-first user interface

- **Status:** accepted (founding)
- **Date:** 2026-08-22
- **Provenance:** UNCONFIRMED — drafted by `agent:opus-founder` during a hands-off founding. Not human-signed.

## Context

The founding paragraph calls for "a little" game and "a simple murder mystery
clue like game" whose real purpose is to exercise nahel's multi-agent,
multi-LLM, shared-cost machinery. The interface is therefore overhead against
the actual goal: every hour spent on rendering a board is an hour not spent on
the thing being tested.

A terminal interface also happens to be what an agent can drive. A scripted
playthrough that feeds stdin and asserts on stdout is a real end-to-end test;
a browser UI would need a driver, a server, and a harness before the first
assertion.

## Decision

The product surface is a terminal CLI, launched with `bun run src/cli.ts`.

- Game state is rendered as text: the player's hand, the room they occupy, the
  public event log, and their deduction notes.
- Input is a small command vocabulary — move, suggest, accuse, ask (an
  in-fiction question routed to the game master), notes, save, quit.
- Every command's effect is decided by the engine (ADR-0001); the CLI is a
  reader and a printer.
- Narration from the game master is displayed inline with the engine's own
  description of the same event available as the fallback.

No GUI, no web frontend, no TUI framework in v1.

## Consequences

- The whole game is scriptable, so an end-to-end test is a fixed command
  sequence with asserted output — no driver, no server.
- The run contract is trivially honest: `launch` is the CLI, `healthcheck` is
  `--help`, and `test` is `bun test`.
- Board geometry has to be conveyed in text. Rooms and adjacency are modelled
  as a named graph rather than a grid, which is simpler to describe out loud
  and loses nothing the rules depend on.
- If a GUI is ever wanted, the engine/CLI split means only the CLI layer is
  replaced. That is a v2 conversation and a non-goal today.

## Amendment — 2026-08-23: superseded on movement

Superseded on movement by orchestrator resolution `5rwbt08h` (journal event):
the board is a **dice-and-corridor board per the standard rule set**, not a
named graph.

The "rooms and adjacency are modelled as a named graph rather than a grid"
consequence above no longer holds. `src/engine/board.ts` builds nine room boxes
and seven corridor segments into 77 unit squares with 17 doors and two secret
passages; movement spends a rolled die across those squares, corridor squares
hold one token and block passage, and entering a room ends the move.

Everything else in this ADR stands — the surface is still a terminal CLI, the
engine still decides every outcome, and board geometry is still conveyed in
text. Only the claim about how geometry is *modelled* is withdrawn.
