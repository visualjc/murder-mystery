---
id: bvap0ja2
name: offline-games-terminate-and-replay-identically
created: 2026-08-24T23:27:02Z
tags:
  - engine
  - determinism
  - testing
sources:
  - s877cdg6
---
With a human who never accuses, full offline games at 3, 4, 5 and 6 seats all reach game-over from fixed seeds in well under a second: the deterministic suspect policy closes every game on its own. The same seed plus the same answers replays a byte-identical transcript, and a different seed does not. This is the property the whole engine design rests on and the cheapest regression signal available.
