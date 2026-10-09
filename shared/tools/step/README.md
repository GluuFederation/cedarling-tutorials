# Step helper

Copies a tutorial step's files from a pinned Git commit. Requires Node.js and Git.

## Follow a tutorial

Use a separate checkout for each tutorial. Run its setup once in a fresh baseline
checkout; setup replaces the helper directory. Then, from the repository root:

```sh
node shared/tools/step/run.mjs p1 init --source <reviewed-commit-sha>
node shared/tools/step/run.mjs p1 policy-store --dry-run
node shared/tools/step/run.mjs p1 policy-store
```

Use the article's source SHA and follow its step order. From a project directory,
use `../shared/tools/step/run.mjs`. `--dry-run` previews changes;
`--yes` skips confirmation. Edited target files stop the step.

## Recover an interrupted step

Before writing, the helper saves affected files and a change journal in
`.local/step/<project>/recovery/`, ignored by Git. Printed paths are relative
to your current directory. A failed step can leave some files updated; resolve
the error and rerun that step to finish. Remove a reported lock file only after
confirming the helper has stopped.

There is no undo command. Recovery copies cover helper file changes, not
database contents, Docker volumes, or dependency installations. Restoring files
manually also requires reconciling the helper's progress.

## Add a project

Use [projects/p1.json](projects/p1.json) as the manifest example. Declare the
baseline SHA and ordered `files`, `remove`, and package `scripts` changes. Each
file belongs to one step. Dependency installation stays in the tutorial commands.
Replay the steps in a separate checkout of that baseline before publishing.

Run the helper tests from the repository root:

```sh
node --test shared/tools/step/run.test.mjs
```
