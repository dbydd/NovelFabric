# Review Loop

Run this loop before declaring tooling work complete.

## Loop

1. State the intended change in one sentence.
2. Check whether the result belongs in `tools/`, `artifacts/`, or the harness surface.
3. Inspect the diff for protected files.
4. Verify that input, output, and rollback behavior are still understandable from files.
5. Summarize evidence and any remaining operator risk.

## Questions

- Did I create a reusable tool without proving it needs to persist?
- Did I leave a one-off artifact in a durable directory?
- Is the change easier for the next operator to rerun and review?
- If a protected file changed, is the intent visible in the diff?
