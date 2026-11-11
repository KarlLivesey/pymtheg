# W2-H: a link's baseline is not a review (mega-plan 1.2, S26)

## Contract change

Planning records now keep two separate things for their document links
(links to records and headings; `source:` links are unchanged):

- **Baseline** — `linkBaselines`, a map from link target to the architecture
  revision at which that link was added. The Studio server sets it; it is never
  a review. It exists only so a later change to the target is reported.
- **Review** — `linkReviewRevision`. Set **only** by the explicit
  acknowledgement ("I reviewed these linked targets"). The server never fills it
  in, and it must name a real revision of this architecture.

Rules applied by `savePlanItem` (any client: Studio UI or the HTTP API):

1. Every document link on the saved record ends with a baseline or a review,
   never neither. A link the stored record did not have gets a baseline, on create
   and on edit. Links to the record itself are exempt (a record is never stale
   with respect to itself).
2. Choice of baseline revision:
   - the request's base revision, when that revision contains the target. This
     keeps the conservative rule: a target that changed between the base and
     head is reported;
   - the current head, when the request has no base revision (the link was
     validated against head);
   - **refused with 409** ("not in the revision this edit started from. Refresh
     …") when the request has a base revision that does not contain a *newly
     added* link's target. Neither alternative can promise not to hide a change:
     head would hide changes made between the version the user saw and the save,
     and the server cannot know which later version the client displayed. The
     earliest revision containing the target would avoid hiding changes but report
     ones the user may have seen, and it needs a history scan. Asking the client
     to refresh is the only choice that never hides an unseen change. The draft is
     preserved;
   - the current head, for a link the record *already had* without tracking (an
     old record, or a dropped review) whose target is absent from the base. Such
     a link had nothing to compare against before, and head is the earliest
     revision the server can vouch for.
3. A link keeps its existing baseline across later saves without acknowledgement.
4. A save whose `linkReviewRevision` differs from the stored one (the user pressed
   the acknowledgement) reviews every current link and clears all baselines. The
   new review revision must exist in this store; otherwise the save is refused
   with 409 ("This link review names a revision this architecture does not
   have …"), matching the refusal of a made-up source review snapshot. An
   unchanged stored review is not re-checked.
5. A link counts as covered by an earlier review (or a proposal's
   `originRevision`) only if it was on the stored record and the saved record
   still has a review or origin. If a client edit drops the review, the links get
   baselines; no review is invented.
6. Client-sent `linkBaselines` are ignored; the server derives them from the
   stored record. Removed links drop their baselines.

This replaces the paragraph in `docs/decisions.md` (around line 542) that says
"New links use the supplied source revision", which was done by filling the
review field. New links now use the supplied revision as a *baseline*.

## Reporting

- The work list (Studio `GET /api/architecture/work`, MCP `architecture` `work`)
  compares each document link with one earlier revision, chosen by
  `linkComparisonBase` (`src/architecture/schema.ts`): its baseline if it has one,
  else the review, else `originRevision`. The plan editor's linked-target
  comparison uses the same function per link (`web/src/PlanEditor.tsx`).
- Messages state which applies: "… since this link was added (never reviewed)"
  versus "… since this plan reviewed it" (`changed-target`, `retitled-target`,
  `moved-target`; `diverged-target` and `unknown-link-review` likewise). A link
  compared only with a proposal's `originRevision` is reported as never reviewed:
  the proposal added it, and nobody acknowledged it.
- **Comparison unavailable.** If the target exists now but is absent from the
  baseline or review revision, the work list reports an explicit finding:
  `unknown-link-review` with message "Comparison unavailable: linked target …
  is not in the revision …", for that link. The comparison is never skipped
  silently. This reuses the existing `unknown-link-review` kind instead of adding
  a new one, because the implementation view (`src/implementation/workspace.ts`)
  maps that kind to "design-unknown" and would map an unknown kind to
  "design-changed".
- Each link finding carries a new optional field
  `linkReview: "reviewed" | "never-reviewed"`.
- The entity planning projection (Studio record API and MCP architecture
  records) exposes `planning.linkBaselines` next to `planning.linkReviewRevision`.
- `linkBaselines` is administrative metadata for the implementation plan hash,
  like `linkReviewRevision`. Index version 19 → 20 (v19 stored indexes are
  re-derived; v19 bundles are still accepted).
- The plan editor's comparison panel (`web/src/LinkedTargetComparison.tsx`,
  whose only caller is `web/src/PlanEditor.tsx`) takes a required `label` from
  `linkComparisonBase`. Its heading reads "Compare linked target with version when
  this link was added", "… with reviewed version", or "… with earlier version"
  when the link has no recorded revision. When the earlier revision does not hold
  the target, it says "No retained target at the {label}."; when the link has no
  earlier revision at all, it says "No earlier revision is recorded for this
  link." Layout is unchanged.

## Review bookkeeping is not a content change

Plan record entities gain a `relationshipHash`: the hash of the record without
its review and baseline fields (`linkReviewRevision`, `linkBaselines`,
`sourceRoots`, `sourceExpectations`, `sourceHashes` and the transient source
selection fields). The link-change comparison already prefers `relationshipHash`
when both sides have it, so pressing review on record Y no longer makes a link to
Y report `changed-target`. Title, text, links, status, acceptance and evidence
still count. `contentHash` is unchanged, so implementation comparison, observation
and evidence staleness (which use `contentHash`) are unaffected. Only
`src/architecture/work.ts` reads `relationshipHash`.

## Records saved before this change

They cannot be repaired, because a server-filled review is stored exactly like a
real one. They are treated deterministically:

- A stored `linkReviewRevision` (whether the user pressed the button or the old
  server filled it in for a new record) is treated as a **review**. Links present
  in such a record are reported as "since this plan reviewed it". A stored review
  is not re-validated; if its revision does not exist, the existing "revision used
  to review these links is unavailable" finding appears.
- Links stored with no review, no `originRevision` and no baseline (the old
  edit-path and no-base-revision cases) have nothing to compare against and stay
  untracked until the record is next saved. That save gives each such link a
  baseline (rule 2), so changes from then on are reported as "never reviewed". No
  review is invented for them.

## Not changed

- Source-link baselines and review (`sourceRoots`, `sourceReviewSelection`,
  `sourceReviewSnapshot`; forged snapshots are still refused with 409).
- What counts as a target change (apart from ignoring review bookkeeping, above).
