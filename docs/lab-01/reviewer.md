# Lab 1 — Peer Review Record

**Author:** Siripitch Chaiyabutra — 67070503440 — GitHub: siripitch-c
**Peer reviewer:** Tana Udompornkul — 67070503418 — GitHub: Tana4Work

**Peer reviewee:** Thanaphon Ratchatakulpong — 67070503417 — GitHub: thanaphon3417

## Pull Requests I authored (reviewed by Tana4Work)
| PR | Branch | Reviewer verdict |
|----|--------|------------------|
| https://github.com/siripitch-c/TokTickIT/pull/5 | feature/1-project-foundation | Approved |
| https://github.com/siripitch-c/TokTickIT/pull/6 | feature/2-health-check | Approved |
| https://github.com/siripitch-c/TokTickIT/pull/7 | feature/3-category-seed | Approved |
| https://github.com/siripitch-c/TokTickIT/pull/8 | feature/4-category-list | Approved |

Reviewer comment I received: Nicely done
How I responded: Thanks

## Pull Requests I reviewed (for thanaphon3417)
https://github.com/thanaphon3417/TokTickIT/pull/5
feature/1-project-foundation
My comment: Nice work. Verified the client starts with npm run dev and Bootstrap styles are applied. Backend boots cleanly and /prisma/schema.prisma looks correct. Ran the test suite locally and everything passes.
Partner's response: Thank you so much.

https://github.com/thanaphon3417/TokTickIT/pull/6
feature/2-health-check
My comment: /api/health returns 200 with the correct JSON shape. Ran npm test - prefix server and the Supertest test passes. Also tested the frontend — clicking Check System correctly shows Online, and I stopped the backend to confirm the Offline/error state renders too.
Partner's response: Thank you very much.

https://github.com/thanaphon3417/TokTickIT/pull/7
feature/3-category-seed
My comment: Verified — migration applies cleanly, seed correctly inserts all four categories, and re-running it produces no duplicates. No credentials committed.
Partner's response: Thank you for checking my PR! I will continue on issue 4.

https://github.com/thanaphon3417/TokTickIT/pull/8
feature/4-categoty-list
My comment: Checked the categories endpoint, Prisma query, and the loading/success/error states in the UI. All match Issue 4's acceptance criteria.
Partner's response: Thank you for checking my PR. I will proceed to updating documents.