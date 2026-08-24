# murder-mystery

A Clue-style deduction game for the terminal, with an LLM acting as game master.

**Prototype.** Built as a dogfood exercise for [nahel](https://github.com/visualjc/nahel) — the whole thing was planned, built, reviewed and closed through nahel's dispatch playbooks, and the `nahel/` directory in this repo is the durable record of that.

## Play

```bash
bun install
bun run src/cli.ts --players 3
```

Offline, with no network call and no API key:

```bash
bun run src/cli.ts --no-llm
```

Every game is replayable — the seed is printed at the start, and `--seed <n>` plays that exact game again.

```
bun run src/cli.ts --help
```

## The LLM part

The engine is deterministic and owns every rule. The LLM never decides anything: it builds the opening scenario, narrates what the engine already resolved, and answers in-character questions. It is never told the solution, and the prompts carry no game state that could leak it.

Set `POE_API_KEY` in the environment or in a gitignored `.env.local` at the repo root. Without one the game still plays — it says so once and falls back to the engine's own text. `--model` (or `POE_MODEL`) picks the model; the default is `claude-sonnet-4.5`.

Token usage is printed per model when the session ends.

## Layout

- `src/engine/` — board, cards, dice, turn legality, refutation. Deterministic, seeded, no LLM.
- `src/llm/` — OpenAI-compatible client, config resolution, token ledger, output sanitizing.
- `src/gm/` — scenario builder, narrator, in-character Q&A, opponent policy, notebook.
- `src/ui/` — argument parsing, render, the game loop.
- `docs/adr/` — the three decisions the build is standing on.
- `nahel/` — items, runs, journal and the `build-review` playbook this was built through.

## Tests

```bash
bun test
```

No mocks against real behaviour: the LLM tests drive a fake vendor over the real client, and the e2e tests run the actual CLI as a process.
