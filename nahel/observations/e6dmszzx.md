---
id: e6dmszzx
name: stdin-readline-drops-unqueued-lines
created: 2026-08-24T23:27:02Z
tags:
  - stdin
  - cli
  - gotcha
sources:
  - b6jm2qxy
---
Node's readline drops every 'line' event that arrives while no rl.question() is pending. A piped script (bun run src/cli.ts < answers.txt) therefore lost all but the first answer or two and the game quit early on EOF. src/ui/io.ts createStdio keeps a standing 'line' listener that queues input, and ask() shifts from that queue. Any future stdin rework must keep the standing listener.
