# V5 Template JSON Schema

## Status

Active phase-one `template.json` contract.

## File name

Every built-in template must expose exactly one root metadata file named `template.json`.

## Minimum shape

```json
{
  "name": "novel-basic",
  "description": "Base workspace for novel-oriented projects.",
  "protectList": [
    "AGENTS.md",
    "SOUL.md",
    ".agents/skills/**"
  ]
}
```

## Phase-one schema

```json
{
  "type": "object",
  "additionalProperties": true,
  "required": ["name", "description", "protectList"],
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1
    },
    "description": {
      "type": "string",
      "minLength": 1
    },
    "protectList": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "variables": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      },
      "description": "Simple key-value default map. Caller-provided values override these defaults."
    }
  }
}
```

## Semantics

### `name`

- template identifier
- should remain stable across revisions of the same built-in template

### `description`

- short human-readable purpose statement
- consumed by both users and agents

### `protectList`

- authoritative declaration of protected files and paths
- may mix relative paths and globs
- no global default exists outside the template

### `variables`

- optional in phase one
- simple key-value string map only
- values act as template defaults
- caller-provided values override template defaults
- values substitute into text file contents and file/directory names
- not a typed schema system

## Out of scope

- typed variable metadata
- defaults with validation rules
- binary substitution
- inheritance from user template namespaces
- a mandatory phase-one `artifactsPath` field
- a mandatory phase-one `commitPrefix` or `commitMessageTemplate` field
