# Production release runbook

MoeTracker releases are manual, exact-SHA promotions. Merging to `main` never deploys by itself.

## One-time Google/GitHub setup

Create three dedicated Google service accounts: deploy, build, and runtime. Do not reuse the Compute Engine default account or the legacy JSON-key deploy account. Configure a GitHub Workload Identity Federation provider whose attribute condition restricts tokens to repository ID `1300351996`, owner ID `279140809`, `refs/heads/main`, `workflow_dispatch`, and `.github/workflows/deploy-once.yml`. Grant only the permissions in the independently reviewed IAM plan.

Configure the GitHub `production` environment and these repository or environment variables:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`: full provider resource name.
- `GCP_DEPLOY_SERVICE_ACCOUNT`: dedicated deploy service-account email.
- `GCP_BUILD_SERVICE_ACCOUNT`: dedicated source-build service-account email.
- `GCP_RUNTIME_SERVICE_ACCOUNT`: dedicated runtime service-account email.

No JSON service-account key is read by the workflow. Remove the legacy `GCP_SA_KEY` repository secret after the keyless path has completed a reviewed release and recovery drill. Configure required runtime Secret Manager mappings on the existing Cloud Run service before release; this workflow preserves those mappings and does not fetch secret values into GitHub.

## Release gate

1. Merge the reviewed change and wait for CI on `main`. Preflight uses the scoped GitHub token to verify the accepted SHA is the current main head and has a successful `ci.yml` main-push run; an attestation alone is insufficient.
2. Have Astra independently review the exact current `main` SHA and record the verdict on this repository's PR or issue.
3. A release coordinator manually runs **Release MoeTracker**, enters the full 40-character SHA and review URL, checks the review attestation, leaves **candidate only** checked, and leaves candidate revision empty. The workflow validates that the SHA is both checked out and the exact current `origin/main` head. The checkbox records the coordinator's attestation; it does not technically prove reviewer identity, so the linked review remains required evidence.
4. Record the candidate revision from the successful evidence artifact. On that exact checkout, run the local authenticated HTTP role suite (`npm run test:release` plus `npx vitest run tests/httpSecurity.test.ts`); production smoke deliberately uses no real password, key, or session.
5. Run **Release MoeTracker** again with the same SHA/review evidence, uncheck **candidate only**, and enter the exact candidate revision. The workflow refuses any revision name that is not deterministically bound to the service and SHA, rechecks the candidate URL and SHA, then promotes it without rebuilding.
6. If GitHub reports missing WIF/IAM permission, stop and repair the least-privilege setup. Never restore the JSON-key fallback.

## Automated order and evidence

The candidate-only run executes checks and a high-severity production dependency audit, records the current named Cloud Run traffic split and current Firebase Hosting version, then deploys a tagged Cloud Run candidate with zero normal traffic. Candidate smoke checks verify the exact build SHA, public health/config shape, missing and invalid bearer denials, and server-artifact denials.

The separate promotion run accepts only the deterministic revision name for that service and SHA, repeats the candidate smoke, and promotes only that revision to 100%. Its normal Cloud Run URL is rechecked before Firebase Hosting is published. Firebase is published last and its public URL is checked against the same SHA. `release-evidence/release.json` is uploaded for 90 days with the prior state, exact candidate revision, smoke results, review link, and outcome. It contains no access token or secret values.

## Failure and recovery

Before promotion, a failure leaves normal traffic and Hosting unchanged. After promotion, any later failure attempts to create a new Firebase live release from the captured prior Hosting version and restores the exact prior named Cloud Run traffic split. Recovery results are written to the evidence artifact and the job still fails. If automatic recovery is incomplete, use the captured `firebaseHostingVersion` and `cloudRunTraffic` values; do not guess a revision.

MoeTracker is currently a development environment and its application data/state is disposable. This release has no schema migration. The first old revision still runs as the default Editor identity, which the new deploy account must not impersonate; automatic recovery is a best-effort safety path, not a reason to broaden actAs permissions.

After the first successful keyless release, perform that bounded rollback drill while the previous revision is still known-good. Verify `/api/health`, `/api/config`, unauthenticated protected-route denial, and artifact denial at both the Cloud Run and Firebase URLs. A release is not accepted until the evidence artifact, production checks, and rollback target are recorded in the release/PR record.
