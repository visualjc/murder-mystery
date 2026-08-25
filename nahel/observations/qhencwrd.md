---
id: qhencwrd
name: critical-events-are-engine-voiced
created: 2026-08-24T23:27:20Z
tags:
  - narration
  - adr-0001
  - design
sources:
  - xc8j02y9
---
Deduction-bearing events (suggestion-made, suggestion-refuted, suggestion-unrefuted, refutation-card-shown, accusation-made, player-eliminated, game-over) are never sent to the narrator at all; the engine's own sentence is the player's only account of them. The earlier form printed BOTH the engine sentence and the model's retelling, which read as a stutter and leaned on the two strings happening to differ. Withholding the event is the stronger rule, the shorter transcript and the cheaper prompt. Consequence: NarrationLine.source distinguishes 'engine' (deliberate) from 'fallback' (vendor failed), or every suggestion would raise the offline notice.
