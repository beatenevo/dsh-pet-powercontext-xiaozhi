# Repository Collaboration Guidelines

These defaults apply throughout this repository. Explicit instructions for the current task take precedence.

## Branches, Commits, and Pull Requests

- Create new feature branches from the latest `origin/master`, using the `codex/` prefix by default. Inspect the working tree first and preserve existing uncommitted changes.
- When asked to merge master, fetch first and merge `origin/master`. Understand each conflict and preserve the behavior needed from both sides; choosing ours or theirs for an entire file is not sufficient verification.
- Review the actual diff before committing and include only task-related files. Exclude temporary logs, screenshots, videos, and directories such as `.playwright-cli/` and `output/` unless explicitly requested.
- Follow `type(scope): subject` for commit messages and describe the concrete implementation or behavior change. See [git-commit](.agents/skills/git-commit/SKILL.md). Commit and push only within the user's authorized scope.
- **PR titles and descriptions must be written in English.** Describe the final implementation, the problem it solves, behavior changes, validation results, and actual limitations. Update the description when subsequent changes alter the scope.
- After creating or updating a PR, verify its remote head, base, title, and description, and return the PR link to the user.

## Implementation and Validation

- Follow [dsh-plugin-standards](.agents/skills/dsh-plugin-standards/SKILL.md) and [dsh-plugin-comment-spec](.agents/skills/dsh-plugin-comment-spec/SKILL.md) for plugin code and comments. Their detailed rules are not duplicated here.
- Use a Node.js version satisfying the engines requirement in `dsh-pet/package.json`. Run project commands from `dsh-pet/`.
- Before delivering code changes, run relevant tests and these checks: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:cycles`, `npm run check:runtime`, `npm run check:openapi`, `npm test`, and `npm run build`. For documentation-only changes, check relevant formatting, links, and content.
- When merge conflicts affect configuration, interfaces, or packaging, verify the resulting behavior. Packaging-list changes require checking build artifacts and the npm package file list; removing conflict markers alone is insufficient.
- Store temporary test data, logs, and validation artifacts under `/data/codex-tmp/`, and set `TMPDIR` when running tests. Do not overwrite or clean up the user's existing artifacts.
- Report checks actually performed and their results. Distinguish local tests, remote CI, mergeability, and unverified behavior; passing one does not establish overall release readiness.

## Robots and External Services

- Treat runtime-discovered MCP tool definitions as authoritative. Preserve the original types of external identifiers, especially long integer IDs represented as strings; do not convert them to JavaScript Number.
- Preserve per-action confirmation and serialized execution for physical actions. After a timeout, disconnection, or cancelled wait, do not automatically retry an action that may already have been dispatched.
- Expose only capabilities the service actually provides. When no stop tool exists, clearly state that cancelling the local wait does not stop the device. A successful connection does not establish that the robot is stationary.
- Mock-server tests, successful protocol responses, and UI screenshots do not prove that physical actions completed. Explicitly disclose when physical hardware or a real backend has not been validated.
