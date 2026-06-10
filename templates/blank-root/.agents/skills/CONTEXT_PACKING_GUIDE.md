# Context Packing Guide

Pack context whenever the task forks, pauses, or survives more than one reviewable loop.

## Required fields

- goal
- `candidate-a`
- `candidate-b`
- chosen branch
- rejected branch and reason
- files inspected
- files changed
- verification completed
- open risks
- next safe action
- rollback point

## Rule

Context packs are control surfaces, not diaries. If a pack cannot tell the next operator why one branch was killed and the other survived, it is not ready.
