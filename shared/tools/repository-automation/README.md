# Repository checks

`pnpm check` tests the CI tools and validates every published tutorial's metadata
and referenced images. Application changes run the affected projects on Linux,
macOS, and Windows, with separate Docker checks. Tutorial text, images, and README
changes run source validation. Shared runtime or workflow changes run the full
portfolio, as do scheduled and manually dispatched checks.

The Linux browser setup uses Ubuntu 24.04 and official HTTPS package sources.
Each attempt has a three-minute budget. A transport failure can trigger one
retry; signature, package-configuration, and timeout failures stop setup.
The final Quality result check requires every selected job to succeed.

## Inspect a slow run

With the GitHub CLI authenticated, run this from this directory:

```sh
pnpm inspect:ci <run-id>
```

The command separates queue time from execution time and lists slow or failed
steps. It only reads workflow metadata. If every step, including Complete job,
has finished but GitHub still reports the job as running, it flags the unresolved
status and exits unsuccessfully. Check GitHub Status before retrying that job.
An application failure or security-audit finding needs investigation even when
another job has a stale status.
