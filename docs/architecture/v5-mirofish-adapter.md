# V5 MiroFish Position

## Status

Active V5 positioning document for MiroFish.

## Current decision

MiroFish is not part of the phase-one NovelFabric core.

NovelFabric V5 must not be shaped around MiroFish availability.

## Allowed future role

If MiroFish is introduced later, it should be treated as:

- an external capability
- skill-injected
- optional
- subordinate to workspace constraints

## Disallowed current role

MiroFish must not currently be treated as:

- a required runtime dependency
- a built-in StorySwarm replacement inside the product core
- a reason to restore internal HTTP API or MCP compatibility layers
- a driver for widening the Rust tool surface

## Why this boundary exists

Reasons already confirmed in planning:

- MiroFish is not the current project focus
- the user wants it postponed as an add-on
- V5 should first stabilize workspace templates and tool primitives
- external capability choice should not dominate core architecture

## Integration posture

Future integration should prefer:

- text-defined skills
- workspace-local constraints
- optional external invocation paths
- artifact return into the workspace as files

Do not assume a built-in adapter must exist in phase one.
