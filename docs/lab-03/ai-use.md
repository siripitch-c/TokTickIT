# Lab 3 — AI Use and Reflection

**LLM / agent used:** Claude Opus 5, through the Claude Code agent (desktop app).

## Selected key prompts

### 1. Explain the issue before starting it

> Explain where the sprint stands and what this issue requires: what has been
> done, what is left, and what the next step is.

**My reflection:** I asked this at the start of each issue, and again whenever
the session had been summarised and I was not sure what the agent still knew.
Understanding the issue myself first is what let me judge the work afterwards,
instead of only reading whether the tests were green.

### 2. Audit against the documents before every commit

> Before each commit, audit the whole issue against the documents and the
> labsheet for correctness, contradictions and bugs. Fix every bug in the issue
> that introduced it, not in a later one, unless it is genuinely unavoidable.

**My reflection:** The prompt I used most. It kept finding real problems: in
Issue #33, five defects that the tests had not noticed, and in Issue #34 a
session that ended mid-use leaving the person on a broken screen instead of
Login. The second half of the prompt mattered as much as the first — it made
each fix belong to the issue that found it, with a test, instead of becoming a
note for later.

### 3. Explain every change before I commit it

> Explain what was changed in each documentation file, and why.

**My reflection:** The documents change in many small places across an issue,
and a summary of "docs updated" does not tell me what I am about to submit. A
file-by-file explanation meant I could read each change knowing what it was for,
and reject the parts I disagreed with — which I did, removing sentences that
described my working habits inaccurately.

### 4. Question a change that does not fit the issue

> This is a documentation issue — why does it change code files?

**My reflection:** The final issue changed a rule number in the seed, a setup
script and two test titles, which looked out of place in a documentation Pull
Request. The explanation taught me two things. The test titles are evidence:
the traceability tables are checked against them, so a title that cites a rule
the specification does not have is a real inconsistency. And one reference
could not be corrected at all, because it sits in an applied migration file,
and Prisma checksums every applied migration — changing even a comment would
make every existing database report the migration as modified. I kept the text
corrections and understood why the migration had to stay as it was.

### 5. State exactly what has and has not been checked

> Say exactly what has been checked and what has not, before calling the work
> complete.

**My reflection:** This changed the end of the sprint. The agent had reported
the visual review as complete, but when I asked directly it admitted that it
had looked at about 30 of the 75 screenshots, chosen as a sample. I asked for
all of them. The full review found three more real defects — a dialog whose
buttons scrolled off a phone screen, a summary that spilled out of its field,
and a screenshot taken before an upload had finished. A report that sounds
complete is not the same as a check that was complete, and asking plainly was
the only way to tell them apart.

### 6. Leave the decisions to me

> Leave decisions to me: present the options with their trade-offs and a
> recommendation, and let me choose one or add my own.

**My reflection:** The Lab 2 end-to-end tests still used the Requester selector
that Lab 3 had removed. I asked for the options and a recommendation, then set
the direction myself: this lab builds on the last one, so the old tests should
change to fit it. The agent first proposed deleting the Lab 2 visual test, then
reversed that when it re-read `specification.md` §10, which says Lab 2 tests
must still pass or be updated with the reason recorded. I learned to ask which
rule a recommendation rests on, not only what the recommendation is.

### 7. List the steps to test the issue myself

> List every step needed to test this issue by hand, so I can check it myself.

**My reflection:** Every issue ended with my own browser test from a checklist,
with the accounts and full URLs written out. It caught things the automated
tests could not — a status badge that looked wrong to me, and a URL I could not
reach until I had the exact address. It also caught the agent's own mistakes
about my data: it did not know that I had changed two seeded passwords while
testing, and I had to tell it.

## Overall reflection

**How the work was divided.** I set the requirements from the labsheet and the
`docs/lab-03` specifications, chose the direction whenever there was a real
decision, and read what the agent changed before each commit. The agent wrote
the code, the tests and the documentation, and ran the unit and API test
suites. I ran every Git command, created every branch and Pull Request, ran the
Playwright suite myself, and tested every issue by hand in the browser. Every
commit and push in this sprint is mine.

The prompts that taught me the most were questions rather than instructions:
explain this, why does this change, what exactly was checked. Each one either
gave me the understanding to judge the work, or showed me that the work was not
yet what it claimed to be. In Lab 3 I learned in particular that an audit is
only as good as its coverage, and that an agent can describe partial work as
complete unless it is asked exactly what was checked.

I also learned where the agent is least reliable: the details of my own project
and my own data, which it is just as confident about as it is about code. The
discipline was to verify those against the repository and my own testing —
which only worked because I had read the files and done the testing myself.
