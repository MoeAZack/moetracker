# Hybrid replay ingestion

## Safe default: local evidence

The Windows collector defaults to `local-evidence`. It hashes the stable `.vrf`, checks the pinned vrfkit v0.2.5 executable and `build-info.json`, runs vrfkit and the checked-in normalizer locally, validates the bounded schema, and hashes the evidence envelope. The API revalidates its claimed parser identity, source SHA-256, original size, device binding, provenance, structure, and envelope checksum. This is **device-attested evidence**, not cryptographic proof that an uncompromised parser produced it: a compromised enrolled device can forge content and recompute the checksum. Coach review is the trust boundary. A successful submission creates a **coach-review draft**; it never accepts a match or rating automatically.

Configure all three absolute runtime paths before approving an upload:

```powershell
node .\scripts\replay-collector.mjs configure --vrfkit-binary "C:\Tools\vrfkit\vrfkit.exe" --python "C:\Python312\python.exe" --normalizer "C:\MoeTracker\scripts\normalize-vrfkit-export.py" --local-evidence
```

If any runtime component or pin is absent, the collector fails closed. It does not silently switch to raw mode.

## Coach-only raw fallback

Raw mode is an explicit collector setting (`--coach-raw-fallback`), is accepted only for a coach-owned device, and is configuration-gated on both the parser and a dedicated GCS bucket. The API returns an application-expiring GCS resumable URL. The collector uploads directly to GCS; Firebase/Cloud Run never proxy client upload bytes. The resumable URL is treated as a credential, stored DPAPI-encrypted on the device and only in private server state, never printed, and retried after interruption. GCS resumable URIs can otherwise remain usable for up to seven days; MoeTracker schedules cancellation at the shorter application expiry and recovers cancellation timers after restart. Raw mode remains disabled until cancellation and lifecycle behavior pass a deployment canary.

On finalize, the server reads immutable object metadata, verifies size, device, upload id, generation and the complete SHA-256 stream, then queues the persisted parser job. On parse failure the object is preserved for coach retry until TTL. Only after normalized evidence is successfully saved does the server delete that exact object generation and record `deleted`. The UI therefore distinguishes upload, verification, processing, and deletion; no intermediate state is presented as complete.

Required environment:

- `REPLAY_RAW_GCS_ENABLED=true`
- `REPLAY_RAW_GCS_BUCKET=<dedicated bucket>`
- `REPLAY_RAW_SESSION_TTL_MINUTES=30`
- the existing pinned `VRFKIT_*` parser settings

## Cloud gate (not performed by this repository)

Create a **Standard**, regional bucket in the same region as the parser service. [`infra/replay-temp-bucket.tf.example`](../infra/replay-temp-bucket.tf.example) declares the intended bucket controls and [`infra/replay-temp-bucket.lifecycle.json`](../infra/replay-temp-bucket.lifecycle.json) is the standalone age-1 deletion policy. Versioning and soft delete are disabled; age-1 deletion is a failsafe rather than the normal cleanup path. Grant the runtime service account a custom bucket-scoped role with only object create/get/delete permissions. Validate bucket location, storage class, lifecycle, versioning, soft-delete retention, audit logging, and generation preconditions before enabling the flag.

The parser and raw fallback remain disabled until these deployment and IAM checks are proven. This document is not a claim that a cloud environment has been configured.
