---
id: n0sq30bb
name: refutation-sentence-reads-from-the-wrong-side
created: 2026-08-24T23:27:20Z
tags:
  - engine
  - wording
  - open-defect
sources:
  - psy0s4x4
---
OPEN DEFECT, not yet fixed. describeEvent for 'refutation-card-shown' renders 'p1 shows you the Ballroom', which is correct for the SUGGESTER. The same private event is in the REFUTER's log too, so after answering a suggestion the human is told 'p1 shows you the Ballroom' about their own card. Confirmed still present in the seed-42 live drive of 2026-08-24. The sentence needs to know which side of the event the reader is on.
