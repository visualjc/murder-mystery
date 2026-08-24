---
id: ghsv63dr
name: full-command-vocabulary-stays-typable
created: 2026-08-24T23:27:02Z
tags:
  - ui
  - design
  - rules
sources:
  - yy5x815s
  - zhvkjdbr
---
The numbered menu lists only what is legal in the current phase, but the whole command vocabulary stays typable. A word that is legal to SAY but not legal to DO is passed to the engine, which refuses it in its own words. This is deliberate: it keeps the UI from holding a second, drifting copy of the rules. The one carve-out is the forced-refutation prompt, where only 'quit' is matchable, because refutation is mandatory and the other verbs would be nonsense there.
