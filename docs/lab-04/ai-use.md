# Lab 4 — AI Use and Reflection

**LLM / agent used:** Claude Opus 5, through the Claude Code agent (desktop app).

The six below are the instructions I reused throughout the sprint rather than
one-off questions. Lab 3's set still applies; these are what Lab 4 added.

## Selected key prompts

### 1. Begin from the recorded state of the sprint

Ask the agent to read the sprint state file first and report where the work
stands before doing anything else.

**My reflection:** Lab 4 ran long enough that the conversation was summarised
several times, and detail was lost at each one. Keeping the state of the sprint
in a file outside the repository, and starting every session from it, meant a
summarised session could continue without my re-explaining what had been
decided. Partway through I asked for this to happen automatically instead of
depending on my remembering, and it became the change that saved the most time
in the sprint.

### 2. Audit the work against the labsheet and the sprint documents

Ask for a detailed check of the completed work against the labsheet, the
specification, the test plan and the UI specification — and for a statement of
what was checked and what was not.

**My reflection:** The instruction I used most, as in Lab 3. The second half is
what Lab 4 added, and it is the half that mattered: twice the work was reported
as complete, and asking which parts were verified rather than assumed produced
real gaps — a migration test whose row claimed to cover the attachment rules and
covered none, and a requirement in the handout that nothing had ever checked.

### 3. Confirm that the code, the documents and the labsheet still agree

Before each commit, ask for confirmation that nothing in the implementation
contradicts what the documents say, in either direction.

**My reflection:** This caught mismatches both ways — an error code the API
specification named wrongly, a business rule cited from the wrong lab, and a row
in the test plan that quietly pointed at the wrong file after other rows were
inserted above it. I learned to read the whole answer rather than the verdict:
when the reply listed things it could not confirm, that list was usually where
the next problem was.

### 4. Reproduce reported behaviour before explaining it

When I report something seen in the running application, ask for it to be
reproduced rather than accounted for.

**My reflection:** I reported a duplicated panel and was told it was probably an
artefact of the screenshot. It was not — it was a real defect, and it was fixed
once the agent reproduced it instead of reasoning about it. This is the
instruction I would keep above the others, because an agent that has read its
own code is confident about what that code should do, and the person using the
application is the one who can see what it actually does.

### 5. Provide a capture list for the report figures

Ask for a numbered list of the screenshots to capture, with the exact ticket
numbers, accounts, URLs and controls named in each step.

**My reflection:** Thirty-three report figures were captured from lists written
this way, with the identifiers re-queried from the database each time rather
than carried over from earlier in the conversation. Where a step was wrong — a
control that prevents an action rather than refusing it, an account whose
password had been changed earlier in the project — the mistake surfaced at once
because the step had named the value to expect. A general instruction would have
hidden both.

### 6. Keep the agent's own working files out of the graded repository

Require that anything the agent adds for its own benefit stays outside the
repository being submitted.

**My reflection:** The agent proposed adding files to help it resume between
sessions. That is reasonable, but the repository is the work being marked, so
the files were placed outside it and the one that had to sit inside was excluded
from version control. An agent will improve its own working conditions if
allowed to, and it is worth deciding in advance where it may do so.

## My Reflection

Overall this went well. The most useful thing was not any single answer but that
the agent kept track of what I had told it: the way I want issues run, which
commands I run myself, how Pull Request descriptions should read, which accounts
can be used for testing. It wrote the important parts down in files of its own
and read them back at the start of each session, so I stopped repeating myself
every time the conversation was summarised. That made the sprint faster and
noticeably easier to pick up again after a break.

The work still needed checking. The agent was wrong about a defect I had seen
myself, and it wrote tests that misread documents it had written earlier in the
same sprint — both found by asking it to check again rather than by it noticing.
What it is good at is being thorough on demand across a large amount of material;
what it cannot do is decide when something is finished. That judgement stayed
mine, and I think it should.
