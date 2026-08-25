# Bugs

Defects found by playing the game. Newest first within each section.

Nahel item ids in brackets — `nahel item update <id> --status <status>` and
`nahel progress --item <id>` are the record; this file is the readable index.

## Open

### `ask` is limited to once per turn by the menu only, not by the rule  [`fher0yzd`]

**Found:** 2026-08-24, live game, seed 535986.

After you question a suspect, `ask` disappears from the turn menu — the
intended rule is one question per turn. But the whole command vocabulary stays
typable by design (`src/ui/loop.ts`, `unlistedVocabulary`), so typing `ask`
runs it again. Confirmed twice in one turn against Colonel Mustard.

`doAsk` *sets* `askedOnTurn` but never *checks* it. The limit is cosmetic.

Two ways out, and it is a product question which:

- enforce it — `doAsk` refuses when `askedOnTurn === view.turnNumber`, and the
  refusal is printed like any other, or
- drop it — questions are free, and the menu stops implying otherwise.

Worth noting the tension with the typable-vocabulary rule: that rule says the
ENGINE owns what is legal, and the UI never holds a second copy of the rules.
This limit lives in the UI and the engine knows nothing about it, which is why
it leaks. Whichever way it goes, the rule should live in one place.

### Refutation sentence reads from the wrong side  [`5p3qef9y`]

**Found:** journaled during the original build as finding `psy0s4x4`, never
actioned; re-confirmed 2026-08-24 in the seed-42 and seed-535986 live games.

`describeEvent` for `refutation-card-shown` renders:

```
p1 shows you the Candlestick.
```

That is correct for the SUGGESTER. The same private event is in the REFUTER's
log too, so the player who just answered a suggestion is told they showed
themselves their own card.

The sentence needs to know which side of the event the reader is on.

### Sessions cannot be saved or resumed  [`0msryhyf`]

Deliberately deferred, not a regression. The item's original scope named a
`save` verb in the command vocabulary; save and any load/resume path were never
built, and shipping save alone would have been half a feature. Quitting loses
the game.

## Fixed

All in [PR #1](https://github.com/visualjc/murder-mystery/pull/1), branch
`fix/played-transcript`. Not merged.

| | |
|---|---|
| **Every critical event printed twice**  [`hz7b0606`] | The engine's sentence and the model's retelling of it, back to back. Fixed by never sending deduction-bearing events to the narrator at all — the engine's sentence is the only account, so nothing depends on the two strings differing. |
| **Narration lines matched by array position**  [`nrntyese`] | The model wrote about a later event in an earlier slot and left the real slot unusable, so a scenery fact printed twice — narrated in the wrong place, engine fallback in the right one. The reply is now `{n, text}` and an entry lands on the event it names or on nothing. Also cured a false "the game master is not answering" notice in a healthy game. |
| **`quit` refused at the forced-refutation prompt**  [`h4d88mt9`] | `--help` promises `quit` works everywhere; that menu was built from the card options alone. `quit` alone of the vocabulary is now matchable there. |
| **Narrator used seat labels and spoke coordinates**  [`3wgh3z5b`] | "Player two moved from position sixteen-seven" — the model reading `describeEvent`'s internal vocabulary aloud. The prompt now carries the public seat-to-character roster and forbids seat ids, coordinates and present tense. |
| **Move menu buried rooms under corridor squares**  [`j8jhvt25`] | Rooms and secret passages sort first; corridors keep their order, since position decides next turn's reach. |

## The pattern worth remembering

Every defect in this file was found by **playing the game**, and none of them
was caught by the suite — which was 369/0 green when four of them shipped.

Every assertion was about what the code computes. None was about how the played
game reads. The tests added with the fixes assert on the transcript itself, and
that is the class of coverage to keep extending.
