# Lab 2 — Peer Review Record

**Author:** Siripitch Chaiyabutra — 67070503440 — GitHub: siripitch-c
**Peer reviewer (reviewed my work):** Tana Udompornkul — 67070503418 — GitHub: Tana4Work
**Peer whose work I reviewed:** Thanaphon Ratchatakulpong — 67070503417 — GitHub: thanaphon3417

Every Pull Request below was opened against `lab2-staging` and merged only
after the reviewer had reviewed it, as required by `specification.md` §10. Six
of the seven carry a formal **Approved** review on GitHub; the exception is
noted explicitly under PR #19 rather than being presented as an approval.

---

## 1. Pull Requests I authored — reviewed by Tana4Work

| PR | Branch | Issue | Verdict |
|----|--------|-------|---------|
| [#19](https://github.com/siripitch-c/TokTickIT/pull/19) | `feature/1-lab2-spec-testplan` | #11 Sprint specification and test plan | Reviewed and merged by Tana4Work — see the note below |
| [#20](https://github.com/siripitch-c/TokTickIT/pull/20) | `feature/1-lab2-spec-fix` | #11 (follow-up fix) | Approved |
| [#21](https://github.com/siripitch-c/TokTickIT/pull/21) | `feature/2-lab2-requester-context` | #12 Data model foundation & Requester context | Approved |
| [#22](https://github.com/siripitch-c/TokTickIT/pull/22) | `feature/3-lab2-create-ticket` | #13 Create Ticket | Approved |
| [#23](https://github.com/siripitch-c/TokTickIT/pull/23) | `feature/4-lab2-my-tickets` | #14 My Tickets | Approved |
| [#24](https://github.com/siripitch-c/TokTickIT/pull/24) | `feature/5-lab2-ticket-detail` | #15 Requester Ticket Detail & Attachments | Approved |
| [#25](https://github.com/siripitch-c/TokTickIT/pull/25) | `feature/6-lab2-e2e-visual-qa` | #17 E2E, responsive & visual QA | Approved |

### Comments received, and how I responded

**PR #19 — Sprint specification and test plan**
Reviewer comment: *"Everything looks fine, great job"*
Review state: the reviewer left this as a comment and merged the Pull Request
rather than submitting a formal **Approve** review, so GitHub records no
approval event on #19. The same Issue (#11) was completed by PR #20, which does
carry a formal approval from the same reviewer. Every other Pull Request in
this sprint has a recorded **Approved** review.
My response: *"Thank you for checking and approving. However, I found a few
things after a closer review that need to be adjusted. I'll open another pull
request to fix these files."*

This is the one review round I did not simply accept. After it was merged I
re-read the specification against the labsheet and found contradictions in it
that neither of us had caught, so I raised PR #20 to correct them rather than
leave a signed-off but incorrect document in the branch.

**PR #20 — Specification and test-plan fixes**
Reviewer comment: *"That's great noticing an error, great job"*
My response: *"Thank you"*

**PR #21 — Requester context**
Reviewer comment: *"Everything looks fine, approved"*
My response: *"Thank you"*

**PR #22 — Create Ticket**
Reviewer comment: *"Everything seem alright, good job"*
My response: *"Thank you."*

**PR #23 — My Tickets**
Reviewer comment: *"Very Good, approved"*
My response: *"Thank you."*

**PR #24 — Requester Ticket Detail & Attachments**
Reviewer comment: *"Very Good, approved"*
My response: *"Thank you"*

**PR #25 — E2E, responsive & visual QA**
Reviewer comment: *"Very Good, approved"*
My response: *"Thank you."*

---

## 2. Pull Requests I reviewed — for thanaphon3417

All nine were approved after checking the diff against the issue each one
claimed to close.

**[Their PR #19](https://github.com/thanaphon3417/TokTickIT/pull/19)** — `feature/lab2-1-specification`
My comment: *"Everything looks good to me. Good job."*
Their response: *"Thank you so much."*

**[Their PR #21](https://github.com/thanaphon3417/TokTickIT/pull/21)** — `feature/lab2-2-requester-context`
My comment: *"Everything looks good to me. Good job."*
Their response: *"Thank you very much."*

**[Their PR #22](https://github.com/thanaphon3417/TokTickIT/pull/22)** — `feature/lab2-3-ticket-creation`
My comment: *"Everything looks good to me. Good job."*
Their response: *"Thank you for checking."*

**[Their PR #23](https://github.com/thanaphon3417/TokTickIT/pull/23)** — `feature/lab2-4-my-tickets`
My comment: *"Everything looks good to me. Good job."*
Their response: *"Thank you for your time."*

**[Their PR #24](https://github.com/thanaphon3417/TokTickIT/pull/24)** — `feature/lab2-5-ticket-detail`
My comment: *"Nice work. Everything seem fine."*
Their response: *"Thank you for checking."*

**[Their PR #25](https://github.com/thanaphon3417/TokTickIT/pull/25)** — `feature/lab2-6-attachments`
My comment: *"Everything looks fine to me. Nice work"*
Their response: *"Thank you so much."*

**[Their PR #26](https://github.com/thanaphon3417/TokTickIT/pull/26)** — `feature/lab2-7-tests-e2e`
My comment: *"Everything looks fine to me. Nice work"*
Their response: *"Thank you so much."*

**[Their PR #27](https://github.com/thanaphon3417/TokTickIT/pull/27)** — `feature/lab2-documentation`
My comment: *"Nice work. Good job."*
Their response: *"All tasks completed! Thank you so much."*

**[Their PR #28](https://github.com/thanaphon3417/TokTickIT/pull/28)** — `lab2-staging` → `main` (release)
My comment: *"I already reviewed, looks good and does what the issue asks. Nice work."*
Their response: *"Thank you for your time."*

---

## 3. Note on coverage

This file lists the seven feature Pull Requests of the sprint. It cannot list
the two Pull Requests that carry the file itself — the documentation PR for
Issue #18 and the final `lab2-staging` → `main` release PR — because a record
cannot contain the outcome of its own review. The same convention was used in
`docs/lab-01/reviewer.md`, which lists PRs #5–#8 and not the release PR that
merged them.
