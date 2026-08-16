# Lab 1 — AI Use and Reflection  (fill this in)

**LLM/agent used:** Gemini

## Selected key prompts (6–10)
| # | Prompt (summarised) | What I did with the result |
|---|---------------------|----------------------------|
| 1 |Read Lab1_Labsheet.pdf and Lab1_Git_GitHub_CheatSheet.pdf. These files are essential to do the lab. Summarize and explain the concept and what to do in this lab for me. Propose the work flow too. don't start the lab yet. | I skim through the files again with the answer I get from AI to try to understand the lab. |
| 2 |  Help me set up the github repository, project(kanban board), and issues. | I start setting github for this lab. |
| 3 | Help me set up the project step by step(issue 1). Explain in detail. |  I start issue 1 and walk through AI instruction.|
| 4 | Help me create the GET /api/health endpoint and write a Supertest for it (issue 2). | I added the route in the server and ran the test to make sure it returned HTTP 200.|
| 5 | How to write a Prisma schema for Category and seed 4 categories safely without duplicating them?(issue 3) | I created the schema, ran the migration, and put the generated seed code into seed.ts.|
| 6 | Help me fetch the categories from the backend and show them in React using Bootstrap. It needs loading, success, and error states. | I applied the code to my frontend and tested if the loading and offline texts showed up correctly when the server was off. |
| 7 | Help me write Vitest for my React app. It needs to test the heading, online state, and offline state. | I added the test file and adjusted the expected text in the test to match my actual UI. |

## Reflection
Using AI throughout this lab helped me understand the full-stack workflow and various testing tools much faster. However, I learned that instead of simply copy-pasting, I needed to review and adjust the AI-generated code to ensure it precisely met the assignment's acceptance criteria. Overall, AI served as a step-by-step guide and saved a significant amount of time during the project setup phase.