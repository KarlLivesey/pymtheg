# W2-H: a link's baseline is not a review (mega-plan 1.2, S26)

## Contract change

Planning records now keep two separate things for their document links
(links to records and headings; `source:` links are unchanged):

- **Baseline** — `linkBaselines`, a map from link target to the architecture
  revision at which that link was added. The Studio server sets it; it is never
  a review. It exists only so a later change to the target is reported.
- **Review** — `linkReviewRevision`. Set **only** by the explicit
  acknowledgement ("I reviewed these linked targets"). The server never fills it
  in.

Rules applied by `savePlanItem` (any client: Studio UI or the HTTP API):

1. A document link the stored record did not have before gets a baseline, on
   create and on edit. The baseline revision is the request's base revision, or
   the current head when the request has no base revision.
2. A link keeps its existing baseline across later saves without acknowledgement.
3. A save whose `linkReviewRevision` differs from the stored one (the user pressed
   the acknowledgement) reviews every current link and clears all baselines.
4. Client-sent `linkBaselines` are ignored; the server derives them from the
   stored record. Removed links drop their baselines.
5. Links already covered by an earlier review (or by a proposal's
   `originRevision`) are not given a baseline when the record is edited.

This replaces the paragraph in `docs/decisions.md` (around line 542) saying "New
links use the supplied source revision" by filling the review field: new links now
use the supplied revision as a *baseline*.

## Reporting

- The work list (Studio `GET /api/architecture/work`, MCP `architecture` `work`)
  compares each document link against its baseline when it has one, otherwise
  against the review (or `originRevision`), as before.
- Messages state which applies: "… since this link was added (never reviewed)"
  versus "… since this plan reviewed it" (`changed-target`, `retitled-target`,
  `moved-target`; `diverged-target` and `unknown-link-review` likewise).
- Each link finding carries a new optional field
  `linkReview: "reviewed" | "never-reviewed"`.
- The entity planning projection (Studio record API and MCP architecture
  records) exposes `planning.linkBaselines` next to `planning.linkReviewRevision`.
- `linkBaselines` is administrative metadata for the implementation plan hash,
  like `linkReviewRevision`. Index version 19 → 20 (v19 stored indexes are
  re-derived; v19 bundles are still accepted).

## Records saved before this change

They cannot be repaired, because a server-filled review is stored exactly like a
real one. They are treated deterministically:

- A stored `linkReviewRevision` (whether the user pressed the button or the old
  server filled it in for a new record) is treated as a **review**. Links present
  in such a record are reported as "since this plan reviewed it".
- Links stored with no review, no `originRevision` and no baseline (the old
  edit-path and no-base-revision cases) have nothing to compare against and stay
  untracked until the record is next saved; that save gives each such link a
  baseline at the save's base revision (or head), so changes from then on are
  reported as "never reviewed". No review is invented for them.

## Not changed

Source-link baselines and review (`sourceRoots`, `sourceReviewSelection`,
`sourceReviewSnapshot`; forged snapshots still refused with 409). What counts as
a target change. The plan editor's linked-target comparison still uses the review
or origin revision as its "before" (`web/src/PlanEditor.tsx:381`, outside this
chunk); see the hand-back note.
