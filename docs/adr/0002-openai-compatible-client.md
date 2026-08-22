# ADR-0002 — OpenAI-compatible client, Poe as the configured provider

- **Status:** accepted (founding)
- **Date:** 2026-08-22
- **Provenance:** UNCONFIRMED — drafted by `agent:opus-founder` during a hands-off founding. Not human-signed.

## Context

The founding paragraph names the LLM access shape loosely — "api key and
endpoint, or oauth token" — and adds a purpose beyond play: the project is a
test that "we are using different agents, llms, etc and that the token cost is
shared and such". So the client is not incidental plumbing; measuring and
attributing token cost is part of what the project exists to demonstrate.

Vendor SDKs would each impose their own request shape, auth handling, and
usage reporting, which is precisely the variance that makes cost comparison
across providers hard. The OpenAI chat-completions protocol is the common
denominator that Poe and most other hosts already speak.

## Decision

Write one small HTTP client against the OpenAI-compatible chat-completions
protocol and nothing else:

- `POST <base>/chat/completions`, `Authorization: Bearer <key>`, body of
  `{model, messages, ...}`, reply read from `choices[0].message.content`.
- Base URL and model are configuration, defaulting to
  `https://api.poe.com/v1`.
- The key is `POE_API_KEY`, loaded from a gitignored `.env.local`. Never
  committed, never logged, never placed in nahel state.
- Every call returns the response's `usage` object alongside the text —
  `prompt_tokens`, `completion_tokens`, `total_tokens` — and the session sums
  them. Cost is read from the provider's own numbers, never estimated from
  string length.

No vendor SDK is taken as a dependency. OAuth-token auth, mentioned in the
paragraph as an alternative, is out of scope for v1: a bearer key satisfies
the same header and is what Poe takes.

## Consequences

- Switching provider is a base-URL and model change plus a different key name;
  no code path is provider-specific.
- Usage accounting is uniform across providers, which is what makes the
  "token cost is shared" claim checkable rather than asserted.
- Provider-specific features (structured outputs, tool calling dialects,
  streaming extensions) are unavailable unless they are expressible in the
  common protocol. Given ADR-0001 — the model only narrates — this costs
  nothing today.
- A provider that diverges from the protocol is simply unsupported in v1, per
  the recorded non-goal.
