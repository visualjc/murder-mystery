---
id: gfnqeysj
name: nahel-0-4-3-cannot-read-0-5-0-stores
created: 2026-08-24T23:27:35Z
tags:
  - nahel
  - tooling
  - gotcha
sources:
  - ad4fcr12
---
A nahel binary older than the store it reads can refuse it outright rather than degrade. Installed nahel 0.4.3 hard-failed on this store with 'Unrecognized key: "roles"' because 0.5.0 writes a roles section into nahel/config, so every command including 'nahel brief' was dead until 'bun run install:local' from the nahel epic branch replaced the binary. There is no forward-compat degradation and nothing in the run that wrote the config checked that the shipped CLI could still read it.
