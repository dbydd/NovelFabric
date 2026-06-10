# V5 Template Spec

## Status

Active V5 template specification.

## Required template files

Each built-in template must include:

- `AGENTS.md`
- `SOUL.md`
- `.agents/skills/`
- `template.json`

Optional:

- `.pi/`
- any content directories chosen by the template author

## Built-in template set

Phase-one built-in templates:

- `blank-root`
- `novel-basic`
- `tooling-only`
- `analysis-research`

## `template.json`

### Required fields

- `name`
- `description`
- `protectList`

### Optional fields

Examples may later include:

- `variables`
- display metadata
- template versioning hints

## `protectList`

Rules:

- no global default set exists
- every template declares its own protection surface
- entries may be relative paths or globs
- updates touching matched files must flow through protected mutation and auto-commit

## Variables

Phase-one variables use simple key-value replacement.

Default replacement scope:

- text file contents
- file names
- directory names

Not in scope:

- binary rewriting
- typed variable schema
- heavy validation logic

## Authoring principle

Template authors should prefer expressing behavior through:

- `AGENTS.md`
- `SOUL.md`
- local skills
- nested constraint files

Do not overencode agent behavior into tool code when text constraints are sufficient.
