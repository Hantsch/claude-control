# Fixtures

Two kinds, both required by CONCEPT.md §10.

## `samples/` — committed files, read from disk by `test/unit/samples.test.ts`

These are the shapes the parser must survive, stored as actual files so the tests exercise
the real read path (`readTail`, `readRegistry`, `readIdeWindows`) rather than an in-memory
array. They are **written to match the record shapes and field distributions measured in
docs/RESEARCH.md**, not copied from real transcripts: a real excerpt would carry prompt and
response text into the repository, and §4 is explicit that conversation text must never
leave the process.

Where a fixture encodes a measured fact, the fact is named in the file list below so the
number can be re-checked against a real `~/.claude` later.

| File | What it pins down |
|---|---|
| `samples/projects/c--development-Hantsch-claude-control/bookkeeping-tail.jsonl` | The last line is `last-prompt` — true for 237 of 290 real files. State must come from the newest `user`/`assistant` record, not the last line. |
| `samples/projects/c--development-Hantsch-claude-control/torn-tail.jsonl` | Final line cut off mid-write. Must be skipped silently, not treated as corruption. |
| `samples/projects/c--development-Hantsch-claude-control/queue-remove.jsonl` | `queue-operation` with `operation: "remove"` — measured 218 times against 997 `enqueue` and 775 `dequeue`. A withdrawn prompt must not pin the session to `queued`. |
| `samples/projects/c--development-Hantsch-claude-control/synthetic-model.jsonl` | `message.model: "<synthetic>"` — 36 real records. Must not crash the parser or be reported as a model. |
| `samples/projects/C--development-Hantsch-Browser-MMO/subagent-run.jsonl` | An `Agent` tool call issued alongside a `Grep` call and paired with its own result, so parallel-call pairing is exercised. Its directory is spelled `C--…` while the records say `c:\…`, which is the slug-casing mismatch. |
| `samples/sessions/17152.json` | A live registry entry in the RESEARCH.md §1 shape. |
| `samples/sessions/31208.json` | A second live entry whose `cwd` casing does not match its directory on disk — resolved through `ClaudeAdapter.discoverLiveSessions`, so the case-insensitive slug lookup is covered end to end. |
| `samples/sessions/4242.json` | A stale entry: the PID is alive but belongs to a different process (`procStart` mismatch). |
| `samples/ide/41000.lock` | An IDE lock **including an `authToken` field**, so the privacy test can prove the parser never carries it through. The value is obviously fake. |

## `builders.ts` — programmatic records

Used where a test needs a specific clock offset or a large synthetic tree (the ~250 MB
cold-start tree). Same shapes, generated on the fly.
