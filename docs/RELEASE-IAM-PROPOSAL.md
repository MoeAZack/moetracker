# Release identity proposal (conditionally approved)

Read-only discovery 2026-10-12, Africa/Cairo. No IAM changes applied at proposal time.

Provisioning update: after independent conditional approval, the three named service accounts, custom artifact role and scoped grants below were created successfully. No WIF provider, GitHub variables or new deployment was created at this checkpoint. Owner subsequently clarified the app is unused development with disposable state: legacy rollback preservation is no longer a release prerequisite; security/identity checks remain required.

## Observed

- GCP project moetracker-raad, number329619434756, single service moetracker/europe-west1.
- Live revision moetracker-00027-lof receives100%; existing runtime and default build identity is 329619434756-compute@developer.gserviceaccount.com with project Editor and datastore.user.
- Existing fb-deploy account has firebase.admin, run.viewer, serviceusage.serviceUsageAdmin; prior deployment failed actAs. One GitHub GCP_SA_KEY secret remains. No WIF pools or repository variables exist.
- GitHub repository ID1300351996 and owner ID279140809, MoeAZack/moetracker, main branch.
- Existing data bucket moetracker-raad-data; source bucket run-sources-moetracker-raad-europe-west1; Artifact Registry cloud-run-source-deploy in europe-west1.

## Proposed new identities (do not grant Editor/Owner)

- `moetracker-runtime@moetracker-raad.iam.gserviceaccount.com`: datastore.user on this dedicated project; storage.objectUser only on moetracker-raad-data for the existing GCS mount and backup writes; secretmanager.secretAccessor individually on admin-password, jwt-secret, cron-secret, gemini-api-key. No other secrets unless a future audited feature requires them. No IAM or deployment permissions.
- `moetracker-build@moetracker-raad.iam.gserviceaccount.com`: custom role with artifactregistry.repositories.downloadArtifacts, uploadArtifacts and deleteArtifacts only on europe-west1/cloud-run-source-deploy; storage.objectViewer only on run-sources-moetracker-raad-europe-west1; logging.logWriter on project. No application secret/datastore/data-bucket access. Do NOT grant project-level run.builder (its object-read permission exposes backups).
- `moetracker-deploy@moetracker-raad.iam.gserviceaccount.com`: run.developer only on existing moetracker service, cloudbuild.builds.editor + serviceusage.serviceUsageConsumer + firebasehosting.admin on project; storage.objectUser + storage.legacyBucketReader only on source bucket; artifactregistry.reader only on existing build repository; iam.serviceAccountUser on only the new runtime and build accounts. Never actAs the old Editor identity. No direct application secret access or project IAM admin. Do NOT grant project-level run.sourceDeveloper (it also exposes backup objects). Validate this minimal predefined-role combination against the actual source-deployment calls; add only evidenced missing permissions, never broad Editor/sourceDeveloper as a workaround.
- WIF principal can impersonate only deploy SA using workloadIdentityUser; no broad serviceAccountTokenCreator project grant. All resources remain in this project; no cross-project trust.

## GitHub trust boundary

Create a dedicated global pool `moetracker-github` and OIDC provider `github` with issuer https://token.actions.githubusercontent.com. Map google.subject=assertion.sub and immutable repository_id/owner_id attributes.

Condition must require all of:

```
assertion.repository_id == '1300351996' &&
assertion.repository_owner_id == '279140809' &&
assertion.ref == 'refs/heads/main' &&
assertion.workflow_ref == 'MoeAZack/moetracker/.github/workflows/deploy-once.yml@refs/heads/main' &&
assertion.event_name == 'workflow_dispatch'
```

Bind principalSet for repository_id1300351996 in only this dedicated pool to the deploy SA. A keyless workflow dispatched from main accepts a full SHA, verifies it equals current main, verifies CI, and records independent audit evidence before cloud authentication. No pull_request/pull_request_target or arbitrary-ref deployment. A trusted coordinator dispatch after audit remains a process gate unless the code verifiably enforces it; document honestly.

Workflow vars: GCP_WORKLOAD_IDENTITY_PROVIDER, GCP_DEPLOY_SERVICE_ACCOUNT, GCP_BUILD_SERVICE_ACCOUNT, GCP_RUNTIME_SERVICE_ACCOUNT. They hold identifiers only, not secret values.

## Rollout and residuals

Astra independently conditionally approved this matrix on 2026-10-12. Source-deployment compatibility remains to be demonstrated without traffic. Runtime can modify backup objects; deploy can indirectly access application data by deploying code. These identities are not absolute data-isolation boundaries. Explicitly map every WIF condition claim, retain the canonical provider audience, and use Cloud Logging for build logs.

Review this proposal and workflow before applying cloud writes. Create roles/trust without traffic change; verify bindings. Deploy candidate with new runtime/build accounts, all existing env/secret-version references and GCS mount unchanged. Check access with bounded authenticated owner/player tests before promotion (keep credentials local, never in GitHub artifacts). Capture traffic and Firebase version and enforce candidate and postpromotion checks. This slice has no schema/data migration.

Cloud Run traffic rollback can require actAs on the prior service identity. Do not grant the deployer actAs on the old Editor account. Before the first promotion, test restoring traffic to the existing revision with current authorized local operator fallback; ideally prepare and verify a same-image rollback revision under the new safe runtime identity. Do not call automated rollback proven until tested with the new deploy identity. Database rollback is outside this schema-neutral slice.

Only after a successful keyless release: remove the obsolete GitHub GCP_SA_KEY secret and revoke its exact user-managed service-account key once identity is verified. Do not guess which key it is or remove unrelated integrations. Investigate old Editor identity usage before reducing/removing its grants; old revision may still need it for rollback. Existing broad grants are not silently declared fixed merely by migrating this service.

References: [source-build identity](https://docs.cloud.google.com/run/docs/configuring/services/build-service-account), [deployment federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines). Role permissions were also read directly through gcloud iam roles describe.
