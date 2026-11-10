# Checkpoints and safe planning edits

Current storage version: 6. The architecture index has two distinct identities:
`id` selects an immutable named checkpoint; `snapshotHash` retains its snapshot identity. New archives carry a separate canonical content checksum.
Two checkpoints may reference one snapshot. Stored document payloads and indexes
are deduplicated by content. Every successful named save records a checkpoint,
including a reversal to earlier content. Current selection follows that log.

Opening supported v1–v6 storage read-only never migrates it. An authorized write creates
legacy checkpoints with their original IDs, preserving draft and evidence
references. Migration, checkpoint creation and activation are transactional.
New history exports use `pymtheg.architecture-history/v3`, with separate snapshots
and checkpoints; v1/v2 archives remain accepted. Selected-revision bundles use v3;
v1/v2 bundles retain their original locale-based checksum compatibility.

Adding a planning record is create-only. Editing requires the target document
and original record identity. New IDs must be unique across all planning
records. Changing a title keeps its stable ID. Changing an ID with inbound links
is refused with an explanation; raw JSON edits cannot silently introduce new
duplicates or dangling native links. Existing imported conflicts remain visible
and can be resolved without hiding unrelated records.

Tests: `architecture-checkpoints`, `architecture-checkpoint-api`,
`architecture-plan-integrity`, migration/read-only/history regressions and
`studio-architecture-checkpoint.browser`. These behaviours do not establish that
recorded architecture claims are true or that all possible project cases are covered.


History v3 adds a locale-independent content checksum for each snapshot. Legacy
snapshot IDs remain unchanged; they need not equal the new checksum. Old history
v1/v2 validates its recorded document order before normalization. Selected-revision
bundles also use v3 checksums. A matching stored identity with different content
is refused before import changes the workspace.
