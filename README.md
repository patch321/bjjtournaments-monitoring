# BJJ Tournaments monitoring

Independent browser checks for the public BJJ Tournaments site and its operations monitor. Checks cover usable event rows, search, upcoming and past events, organizer and location pages, calendar feeds, real 404s, certificate and domain expiry, and the monitor heartbeat and mail status.

Staging runs every fifteen minutes. The first hosted acceptance run passed all eleven checks and submitted evidence to the monitor on 2026-11-15. Production will be added when its report-only monitoring prerequisites pass. Cloudflare continues public availability checks every five minutes and pipeline checks every fifteen minutes.

The workflow uses standard GitHub-hosted Linux runners. GitHub provides these free for public repositories. It uploads no artifacts. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Each GitHub environment supplies `OPS_SITE_URL`, `OPS_PAST_EVENT_PATH`, and `OPS_MONITOR_URL` as variables. Its `OPS_MONITOR_READ_TOKEN` and `OPS_EXTERNAL_WRITE_TOKEN` are GitHub Secrets with limited read and evidence-submission permissions. The checks use no database administration or deployment credentials. Logs contain public journey results and sanitized monitor failure categories.

Run `npm ci`, `npx playwright install chromium`, then `npm run check` with the environment variables above. Failed checks exit nonzero. The monitor receives results through its authenticated external evidence endpoint and deduplicates incidents. Missing or stale external results appear as a monitoring gap.

Check sources were initially copied from the staging-verified BJJ Tournaments repository. This repository contains the public checks and their workflow.
