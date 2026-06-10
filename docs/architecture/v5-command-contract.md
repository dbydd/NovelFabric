# V5 Command Contract

## Status

Active V5 phase-one command contract.

## Scope

This document defines the minimum behavioral contract for the three phase-one built-ins under one binary entry:

- `new`
- `guard/apply`
- `pack`

It does not define CLI syntax in full detail yet. It defines required behavior.

Default output bias in phase one:

- human-readable errors first
- no JSON-first requirement

## `new`

### Purpose

Instantiate one built-in template into a target path as a standalone workspace.

### Required behavior

- require a built-in template name
- require a target path
- fail fast if the target path already contains content
- copy the template into the target path
- load `template.json`
- apply simple key-value substitutions when variables are provided
- read optional `variables` defaults from `template.json`
- prefer template-defined defaults when variables are omitted
- let caller-provided values override template defaults
- apply substitutions to text file contents
- apply substitutions to file names and directory names
- skip binary rewriting
- initialize git in the generated workspace
- create an initial commit

### Non-goals

- no typed variable schema in phase one
- no user template namespace resolution in phase one
- no mandatory `validate` pass in phase one
- no automatic merge into pre-populated target directories in phase one

## `guard/apply`

### Purpose

Apply protected mutations to files declared by the template's `protectList`.

### Input shape

Accepts structured patch input:

- target file path (relative to workspace)
- old text segment (exact match for context safety)
- new text segment (replacement)

Phase-one scope:

- accepts one patch at a time
- no bulk multi-file patch input in phase one

### Required behavior

- read `template.json` from the workspace root
- fail fast if the workspace git tree is dirty before starting a protected transaction
- resolve `protectList` entries using both relative paths and globs
- determine whether the requested write touches protected files
- treat a single apply request as one protected transaction
- if protected files changed, create exactly one automatic commit for that apply transaction
- if a file matches multiple protect list rules, do not treat that as a conflict; proceed normally
- generate the commit message through agent-guided text rules and few-shot examples rather than a required structured schema field
- if a caller supplies `--message`, require it to be non-empty, single-line, and reasonably short
- if the workspace provides a commit-message few-shot file with an explicit pattern, enforce that lightweight pattern at the CLI boundary
- include affected protected paths in the commit message or equivalent metadata

### Template authority

- the system provides no global default `protectList`
- the template is the authority for protection scope

### Non-goals

- no global protected-path policy outside the template
- no per-file commit splitting in phase one
- no automatic stash/restore flow in phase one
- no "ignore unrelated dirty files" optimization in phase one
- no mandatory phase-one `commitPrefix` or `commitMessageTemplate` field in `template.json`

## `pack`

### Purpose

Assemble a single markdown context artifact for agent consumption.

### Input shape

Accepts a range/role label or scope identifier rather than explicit file lists.

The tool or agent infers which files belong to the range.

Phase-one scope:

- one range at a time
- output assembled sequentially in the order implied by the range definition

### Required behavior

- accept a range/scope label
- infer or collect matching files
- assemble one markdown artifact
- preserve text readability
- order content sequentially (no automatic reordering)

### Deliberate non-contracts

- no fixed markdown chapter layout
- no universal heading schema
- no forced presentation format beyond "single markdown output"
- no mandatory phase-one schema field for an `artifacts` output path

### Delegation rule

Markdown structure and practical output placement should be driven by:

- template constraints
- `AGENTS.md`
- nested `AGENTS.md`
- local skills
- agent/workspace understanding when the template keeps path rules implicit
- template-local conventions files under `.agents/skills/`, such as pack-scope guidance
