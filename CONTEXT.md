# murder-mystery-test — Ubiquitous Language

Glossary of the domain model. Terms here are used exactly and consistently in code, workflows, docs, and conversation. Sharpen a term the moment it wobbles — a wobbling term is a design bug.

UNCONFIRMED — drafted by an agent during a hands-off founding; not human-signed.

## Game state

- **Card** — one of the 21 deck entries, belonging to exactly one **category**: suspect, weapon, or room. A card is either in the case file or in exactly one player's hand. Never both, never neither.
- **Case file** — the hidden triple of one suspect, one weapon, and one room set aside at setup. It is the answer, it is never dealt, and it is revealed only when an accusation is adjudicated or the game ends. The engine alone reads it.
- **Solution triple** — the three cards making up the case file, named as a value: `{suspect, weapon, room}`. Used when talking about a candidate answer (a player's guess) as well as the true one.
- **Hand** — the set of cards dealt to one player. Private to that player; a hand's contents are proof a card is NOT in the case file.
- **Player** — a participant with a hand, a position on the board, and an accusation status. The human is one player; the rest are LLM-driven suspects, but a player's rules are identical either way.
- **Turn** — one player's move-then-suggest cycle: relocate, then optionally suggest. An accusation may be made on a player's own turn.

## Play actions

- **Suggestion** — a naming of suspect + weapon + room made from the room the suggester currently occupies. It relocates the named suspect and weapon tokens into that room and opens a refutation round. It is a question, not a claim.
- **Refutation** — the answer to a suggestion. Going clockwise from the suggester, the first player holding any of the three named cards shows exactly one of them privately to the suggester. All other players learn only who refuted, never with what. "Nobody could refute" is public information.
- **Accusation** — a naming of a solution triple checked directly against the case file. Correct wins the game; incorrect permanently bars the accuser from winning while leaving them in play to refute. Unlike a suggestion, it is not constrained by the accuser's position.

## LLM layer

- **Game master** — the LLM role that narrates engine-decided outcomes, answers in-fiction questions, and voices the scene. It has no authority: it is told what happened and describes it. It never decides legality, refutation, or the case file.
- **Scenario** — the LLM-generated fiction wrapped around a mechanically standard game: the setting, the six suspects' names and motives, the weapons' descriptions, the rooms' character. Generated once at game start and thereafter fixed for the session.
- **Narration** — the prose the game master returns for a specific engine event. Discardable by construction: if narration fails or is empty, the engine's plain-text description of the same event is shown instead and play continues.
- **Chat client** — the OpenAI-compatible transport: one function that posts messages to `/v1/chat/completions` with a bearer key and returns the reply text plus the response's `usage` numbers. Provider-agnostic by protocol, configured to Poe by default.
- **Token accounting** — the per-call record of `prompt_tokens`, `completion_tokens`, and `total_tokens` read straight from each response's `usage` object, summed per session. Measured, never estimated from string length.
