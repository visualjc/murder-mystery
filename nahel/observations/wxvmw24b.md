---
id: wxvmw24b
name: narration-matched-by-label-not-position
created: 2026-08-24T23:27:20Z
tags:
  - narration
  - llm
  - gotcha
sources:
  - mfd2vcxq
  - b7wzn6jp
---
The narrator's reply is a JSON array of {n, text} where n is the printed line number, and an entry lands on the event it names or on nothing. Reading the reply by array POSITION does not work: a live game proved the model writes about a later event in an earlier slot and leaves the real slot unusable, so the same scenery fact reached the screen twice — narrated in the wrong place, and as the engine's fallback in the right one. The null slot also read as a vendor failure, so a healthy game printed the offline notice and then carried on narrating. Unknown labels, repeated labels (first wins) and unlabelled entries are dropped rather than guessed at.
