# Review Loop

Run this loop before declaring work complete.

## Gate ladder

1. `boundary gate` — did the winning branch preserve root-first discipline?
2. `scope gate` — was one write surface chosen, or did both branches leak through?
3. `diff gate` — is the protected diff single-purpose and reviewable?
4. `evidence gate` — were validation commands actually run?
5. `handoff gate` — can the next operator resume without guessing?

## Failure actions

- gate 1 fail → reject expansion and re-scope
- gate 2 fail → kill one branch and reconverge
- gate 3 fail → rollback or split the change
- gate 4 fail → do not ship
- gate 5 fail → rewrite the pack before exit

## Budget rule

If the same gate fails twice, stop improvising. Re-scope or rollback.
