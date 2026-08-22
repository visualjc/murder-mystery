---
name: compact
description: Distill un-distilled archived journal segments into observations, then mark them distilled
args: ""
---

# Workflow: compact

Load and follow this workflow when `nahel validate` warns that compaction is
overdue (check `compaction.overdue`). Compaction turns raw archived journal
history into durable, searchable observations. It NEVER edits or deletes
journal events — the CLI only appends observations and marks segments.

Before any `nahel` command: if you are an agent, set
`NAHEL_ACTOR=agent:<your-id>` so every journal event carries your identity.

1. Find the un-distilled archived segments: list
   `nahel/journal/archive/*.jsonl` and subtract the marker filenames already
   in `nahel/journal/distilled/` (absent dir = nothing distilled yet).
   Only archived segments qualify — active segments are still being written.
2. Read those segments (`nahel progress` shows the merged timeline; the
   segment files themselves are plain JSONL). This is judgment work: look for
   durable facts worth keeping once the raw events age out of working
   memory — decisions and their reasons, recurring failures, environment
   quirks, constraints discovered the hard way. Routine mutation noise
   (item/run record churn, session markers) usually distills to nothing.
3. For each durable fact, create ONE observation per fact:

       nahel observe <slug> \
         --data body="The fact, stated so it stands alone." \
         --data sources='["<event-id>", ...]' \
         --data tags='["<topic>", ...]'

   `sources` must cite the journal event id(s) the fact came from — the CLI
   refuses ids that are not real journal events. Keep slugs and tags
   recall-friendly: `nahel recall <term>` searches name, body, and tags.
4. A segment with nothing worth keeping is still distilled — distilling
   records the judgment "reviewed, nothing durable", not "observations made".
5. Mark every segment you covered:

       nahel distill <segment-filename> ...

   The CLI refuses segments that are not in the archive, journals the act,
   and creates one empty marker file per segment under
   `nahel/journal/distilled/` (the marker's name IS the record). Re-running
   is harmless: already-marked segments change nothing.
6. Confirm with `nahel validate`: the `compaction.overdue` warning clears
   once the un-distilled archive is back under the configured thresholds
   (`compaction.max_events` / `compaction.max_age_days` in `nahel/config`,
   defaults 200 events / 30 days).

Fallback (degraded environment): if the `nahel` CLI is unavailable, read the
archived segments directly and draft the observations as notes, but make NO
state mutations — observations and the distilled markers are CLI-maintained
state.
