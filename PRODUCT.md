# murder-mystery-test — Product Constitution

> This is the constitution: human-owned, immutable without the maintainer's explicit sign-off, in every governance mode. Agents may propose amendments as observations; they may never edit this file autonomously.

## Goal

> build a little murder trivia mystery game that follows the standard Clue style rule set, but uses an LLM (api key and endpoint, or oauth token) to answer questions and move the game forward (acts like a game master). This mini-app also needs to be planning partner and nahel driven. use the nahel features you are building to build a simple murder mystery clue like game using an LLM as a scenrario builder and simple game master; this tests that we are using different agents, llms, etc and that the token cost is shared and such.

The quoted paragraph is the human's signed content, and the only signed
content in this document (recorded as `founding.paragraph` in `nahel/config`).

## Domain facts

UNCONFIRMED — drafted by an agent from the paragraph; not human-signed.

- A standard Clue/Cluedo deck is three categories: 6 suspects, 6 weapons, 9 rooms — 21 cards total.
- Exactly one card of each category is drawn at setup into the **case file** (the solution triple). It is hidden from every player for the whole game.
- The remaining 18 cards are dealt round-robin to the players. Hands are uneven when the player count does not divide 18; that is normal and not an error.
- A turn is move-then-suggest: the player moves to a room, then may make a **suggestion** naming a suspect, a weapon, and the room they currently occupy.
- A suggestion pulls the named suspect token and weapon token into the suggester's room, which is itself information other players can use.
- Refutation goes clockwise from the suggester: the first player holding any one of the three named cards must show exactly one of them, privately, to the suggester alone. Everyone else sees only THAT a card was shown and by whom, never which card.
- If no player can refute, that fact is public and is the strongest signal in the game.
- An **accusation** may name any suspect/weapon/room triple regardless of the accuser's position. It is checked against the case file: correct ends the game with a win; incorrect eliminates the accuser from winning, though they remain in play to refute other players' suggestions.
- Deduction is a closed-world logic problem: every card is either in the case file or in exactly one hand, so a card proven to be in a hand is proven out of the case file.
- An LLM game master narrates and answers in-fiction; it does not hold the case file's authority. Legality, refutation order, and win/loss are decidable from state alone.
- OpenAI-compatible chat completions is the de facto shape: `POST /v1/chat/completions`, bearer-token auth, a request body of `model` plus a `messages` array of `{role, content}`, a reply at `choices[0].message.content`, and a `usage` object reporting `prompt_tokens`, `completion_tokens`, `total_tokens`.
- That `usage` object is the only honest source of token cost. Cost accounting that estimates from string length is a guess; the response's own numbers are the measurement.
- Poe's `https://api.poe.com/v1/chat/completions` implements that shape, so a single OpenAI-compatible client reaches it and every other provider speaking the same protocol.

## Hard constraints

UNCONFIRMED — drafted by an agent from the paragraph; not human-signed.

1. TypeScript, running on Bun. No other runtime is a target.
2. The LLM endpoint is `https://api.poe.com/v1/chat/completions`. The key is read from a gitignored `.env.local` as `POE_API_KEY` and is NEVER committed, never printed, never written into nahel state, and never embedded in a prompt echoed to disk.
3. The game must be playable end to end as a terminal CLI, with no other interface required.
4. The game-state engine is deterministic and owns every rule outcome — deal, legal moves, suggestion validity, refutation order and choice, accusation adjudication, win/loss. Game legality NEVER depends on parsing LLM output. If the LLM returns nothing, garbage, or an error, the game must still be playable and correct.
5. The LLM's role is strictly narration, scenario flavor, and in-fiction Q&A layered on top of engine-decided facts. It may describe what happened; it may not decide what happened.
6. Token usage from every LLM call is captured from the response's `usage` object and accounted for, so the cost of a session is measured rather than estimated.
7. Single-player against LLM-driven suspects is acceptable scope; a human opponent is not required for the game to be complete.
8. The project is nahel-driven: work is decomposed into nahel items, dispatched through the routing map, and journaled. Founding and planning happen in nahel, not in side documents.

## Non-goals

UNCONFIRMED — drafted by an agent from the paragraph; not human-signed.

- No GUI and no web frontend in v1. The terminal is the product surface.
- No multiplayer networking — no server, no lobby, no remote players.
- No persistence beyond a save file. No database, no accounts, no cloud sync.
- No provider integrations beyond the OpenAI-compatible shape in v1. Other providers are reachable only insofar as they speak that protocol; no bespoke SDKs.
- Not a faithful reimplementation of any published Clue edition's board, art, or trademarks — the standard rule structure only.
- Not a general-purpose LLM agent framework. The LLM client exists to serve this game.

Amendment note (hands-off founding): only the quoted paragraph is
human-signed. Everything else in this document is agent elaboration —
AFK work may rely on it as a parkable assumption, never as an
un-overridable rule, and the human promotes any of it into the
constitution later by signing it. See nahel's own
`docs/adr/0008-constitution-vs-legislation.md`.

## Governance

```yaml
governance:
  product: delegated    # the human handed over a paragraph and left — product legislation is delegated to cross-vendor agent consensus
  architecture: human   # architecture stays human until the architect slice ships
```

## Change log

Every change to this document is recorded here with the human sign-off that authorized it. Agents never edit this file autonomously: amendments are proposed as observations and applied only with the maintainer's recorded sign-off.

- **2026-08-22** — Skeleton scaffolded by `nahel init`; awaiting the maintainer's first review and sign-off.
- **2026-08-22** — Hands-off founding elaboration written by `agent:opus-founder` around Jim Carter's verbatim chat-kickoff paragraph. The founding act itself was agent-run, so the paragraph is transcribed rather than signed; this document is UNSIGNED pending Jim's ratification.
