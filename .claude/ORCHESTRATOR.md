# Orchestrator playbook

Subagents cannot spawn other subagents, so the orchestrator is the main Claude session, not a
subagent. It follows this loop and delegates to the agents in `.claude/agents/`.

## Loop per ticket
1. **Pick** the next ticket (lowest number not done). `progress.py item <id> in_progress`.
2. **Spec**: architect writes /specs/<id>.md, updates ARCHITECTURE.md ("planned") and the OpenAPI
   file. If it lists blocking questions, ask product-owner (or decide) and re-run.
3. **Build**: backend-engineer and frontend-engineer in parallel from the OpenAPI contract.
   Parallel only when they touch different directories.
4. **Verify cheaply first**: run lint, type-check and unit tests. Do not send red builds on.
5. **E2E**: test-engineer writes and runs e2e tests. Route bugs to the owning engineer.
6. **Review**: code-reviewer on `git diff <base>`. Route each issue by `owner`. Max two rounds;
   on a third, the orchestrator decides.
7. **Close**: commit; architect updates ARCHITECTURE.md ("planned" becomes "built");
   `progress.py item <id> done`.

## Progress page
`python3 scripts/progress.py item <id> <status> [note]`
`python3 scripts/progress.py agent <name> working|idle "<what>"`
`python3 scripts/progress.py log <who> "<message>"`
`python3 scripts/progress.py add <phase> <id> "<title>" <owner>`
Update before and after every delegation. progress.html refreshes itself every 10 seconds.

## Rules
- Use the model in each agent file (architect and reviewer on Opus, others cheaper).
- Hand each agent only the ticket ID and file paths; they read the rest themselves.
- Keep the context small: summarise agent reports in a line or two on the progress log.
- Commit per ticket with the ticket ID in the message so reviewer diffs are clean.
