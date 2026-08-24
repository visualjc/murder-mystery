---
id: 2pntx8wx
name: narration-prompt-speaks-the-fiction
created: 2026-08-24T23:27:20Z
tags:
  - narration
  - prompt
  - design
sources:
  - e40cfbqe
---
The narration prompt carries the public seat-to-character roster and forbids seat ids, corridor coordinates and present tense. Without it the model reads describeEvent's internal vocabulary aloud — 'Player two moved from position sixteen-seven' — which is a prompt defect, not a model defect. The roster is already on the player's screen in renderStatus, so putting it in the prompt leaks nothing.
