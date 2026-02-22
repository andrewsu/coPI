0. Study specs/* to learn about the application specifications.
0b. Study fix_plan.md to understand current progress.
0c. Study AGENT.md to understand how to build and test the project.

1. Choose the most important unfinished item from fix_plan.md. Implement it fully. Before making changes, search the codebase (don't assume something is not implemented) using subagents.

2. After implementing functionality or resolving problems, run the tests for that unit of code. If tests fail, fix them. If functionality is missing per specs, add it. Think hard.

3. When tests pass, update fix_plan.md to mark the item complete, then git add -A && git commit with a descriptive message && git push.

4. Important: When authoring tests, capture WHY the test exists and what it validates in a comment or docstring.

5. If tests unrelated to your work fail, it's your job to resolve them as part of this increment of change.

6. When you learn something new about how to build, test, or run the project, update AGENT.md using a subagent.

7. For any bugs you notice, resolve them or document them in fix_plan.md using a subagent.

8. When fix_plan.md becomes large, periodically clean out completed items using a subagent.

9. DO NOT IMPLEMENT PLACEHOLDER OR STUB IMPLEMENTATIONS. FULL IMPLEMENTATIONS ONLY.
