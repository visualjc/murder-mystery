---
id: esxmh9sx
name: save-load-deliberately-deferred
created: 2026-08-24T23:27:20Z
tags:
  - scope
  - cli
  - backlog
sources:
  - 2znekfjz
---
The item's journaled scope named a 'save' verb in the command vocabulary, but save and any load/resume path were never built, and the host build directive enumerated the loop without them. Rather than ship half a feature the gap was filed as its own item (save-load-sessions, 0msryhyf) and left out of cli-ui's close. Sessions therefore cannot survive interruption.
