0. Study specs/* to learn about the application specifications.
0b. Study fix_plan.md to understand current progress.
0c. Study AGENT.md to understand how to build and test the project.

1. Choose the ONE most important unfinished item from fix_plan.md. Implement ONLY that one item. Before making changes, search the codebase (don't assume something is not implemented) using subagents.

2. After implementing, run the tests for that unit of code. If tests fail, fix them. If functionality is missing per specs, add it. Think hard.

3. When tests pass, prepare ALL file updates BEFORE committing:
   a. Update fix_plan.md to mark the item complete.
   b. Update AGENT.md (via subagent) if you learned anything new about how to build, test, or run the project.
   c. Document any bugs you noticed in fix_plan.md (via subagent).
   d. THEN git add -A && git commit with a descriptive message && git push. Everything goes in ONE commit.

4. Important: When authoring tests, capture WHY the test exists and what it validates in a comment or docstring.

5. If tests unrelated to your work fail, it's your job to resolve them as part of this increment of change.

6. DO NOT IMPLEMENT PLACEHOLDER OR STUB IMPLEMENTATIONS. FULL IMPLEMENTATIONS ONLY.

7. IMPORTANT: After committing, STOP. Do not continue to the next task. Use /exit to end the session so a new session can begin with a fresh context window.
