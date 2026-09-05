# Lab 2 — AI Use and Reflection

**LLM / agent used:** Claude Opus 5, through the Claude Code agent.

## Selected key prompts

### 1. Read the requirements before writing anything

> Read the Lab 2 labsheet and the existing `docs/lab-02` files carefully
> before doing anything. Work one issue at a time and finish it file by file
> rather than all at once. Tell me before you change anything.

**My reflection:** The most useful instruction of the sprint, and I reused it
at the start of every issue. Asking for the specification to be read first
meant the work was measured against the labsheet from the beginning instead of
being checked against it afterwards. "Tell me before you change anything" was
just as important — it gave me a point to disagree at before any file moved.

### 2. Give me the options, I make the decision

> If there is a decision to make, lay out the choices with their advantages
> and disadvantages, then let me pick which one to go with.

**My reflection:** This is the habit I would keep for future labs. Early on I
let the agent choose and the code appeared faster, but I could not say why it
was built that way. Once I asked for trade-offs and chose myself, I understood
the design decisions well enough to defend them — which matters, because the
labsheet makes me responsible for every file whether or not I typed it.

### 3. Write the failing test first

> Follow §11 of the labsheet — write the test that fails first, show me why it
> fails, then implement.

**My reflection:** This forced the specification to be settled before any code
existed. More than once the test could not be written at all until the
specification decided something it had left open, which is exactly when I
wanted to find that out rather than after the screen was built.

### 4. Audit against the labsheet and the docs

> Check everything thoroughly against the labsheet and the files in
> `docs/lab-02`. Is anything wrong, missing, or incomplete for this issue?

**My reflection:** The prompt I reused the most, and the one that changed my
working habit. In Issue #1 I approved my own specification without checking it
closely, and my peer reviewer passed it as well — then I found real errors in
it afterwards and had to open a second Pull Request to correct them. After that I
ran this audit before every Pull Request, and it usually found something. I
stopped treating "it looks finished" as finished.

### 5. Tell me what to test by hand

> What exactly do I have to test to be sure this works? List the steps for me.

**My reflection:** Testing my own work is something I should be doing anyway;
what this prompt gave me was a complete list, so I was not deciding from memory
which parts to check and quietly skipping the rest. It also caught things
automated tests could not.

### 6. Give it the real output, not my summary

> *(pasted the failing test output and screenshots of the running app)* This is
> what I actually got. What is wrong?

**My reflection:** Pasting the raw output got a correct diagnosis; describing
the problem in my own words got guesses. This is how the flaky test suite was
found — two test files were competing for the same database rows, and only the
real output showed the pattern.

### 7. Question a change before accepting it

> Is the deactivated-Category problem something we actually need to fix now?

**My reflection:** The answer was no, with reasons: nothing in Lab 2 can
deactivate a category, and the fix would have changed a contract belonging to
an already-merged issue. Not every problem an agent finds is a problem worth
solving in the current scope, and asking first saved work that was not mine to
do yet.

### 8. Explain the issue to me before doing it

> Tell me what this issue actually is, what has been done, and what is left.

**My reflection:** I asked some form of this at the start of every issue, and
for the parts I understood least — the end-to-end testing issue especially — I
also asked Claude separately on the web for a plain explanation and followed up
on whatever I was unsure about. Understanding the issue first is what let me
judge the work afterwards instead of only reading whether the tests were green.

### 9. Check its claims against my own repository

> That is not all true — look at Lab 1 for an example.

**My reflection:** The agent was confidently wrong more than once, and always
about something specific to my project rather than about code: what my Lab 1
documents contain, and how my branches are numbered. Both answers were already
in my repository. The habit worth keeping is that a confident answer about my
own project is still worth checking against the project.

## Overall reflection

**How the work was divided.** I set the requirements from the labsheet and the
`docs/lab-02` specifications, decided the design questions the specification
left open, and read every change before committing it. The agent produced code,
tests and documentation to those instructions. I ran the test suites myself and
did the manual browser testing at all three viewports, which is how several
defects were found — among them the Submit button losing its fill while a
request was in flight, and an attachment filename breaking one character per
line on a narrow screen. Every branch, commit and push in this sprint is mine.

My prompts changed shape over the sprint. At the start they were requests —
"build this screen". By the end most of them were constraints and questions:
what to read first, how far to go before stopping, what to check against, and
"are you sure?".

The turning point was Issue #1. I wrote the specification, my reviewer passed
it, and I still found real mistakes in it afterwards because neither of us had
read it carefully enough. From that point I asked for an audit against the
labsheet before every Pull Request, and I stopped treating a sign-off as proof
that something was correct. The requests produced code quickly, but the
questions produced the corrections, and the corrections are what made the work
match the requirements.

The other thing I learned is where an AI agent is least reliable: not on code,
but on the details of my own project. It is equally confident either way, so
the useful discipline was to verify its claims against the repository — which I
could only do because I had read the files myself.
