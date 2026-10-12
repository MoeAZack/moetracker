#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { assertCandidateTraffic, assertPromotedTraffic, exactTrafficMap, requireValue } from './policy.mjs';
import { smokeDeployment } from './smoke.mjs';

const evidenceDir = 'release-evidence';
mkdirSync(evidenceDir, { recursive: true });

function command(program, args, options = {}) {
  const result = execFileSync(program, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  return result.trim();
}

function gcloud(args) {
  return command('gcloud', args);
}

function describeService(project, region, service) {
  return JSON.parse(gcloud(['run', 'services', 'describe', service, '--project', project, '--region', region, '--format=json']));
}

function writeEvidence(evidence) {
  writeFileSync(`${evidenceDir}/release.json`, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

async function firebaseRequest(path, { method = 'GET' } = {}) {
  const token = gcloud(['auth', 'print-access-token']);
  const response = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${path}`, {
    method,
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: '{}' }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Firebase Hosting API ${method} failed with ${response.status}`);
  return body;
}

async function currentHostingVersion(site) {
  const result = await firebaseRequest(`sites/${encodeURIComponent(site)}/channels/live/releases?pageSize=1`);
  const version = result.releases?.[0]?.version?.name;
  if (!version) throw new Error('could not capture the current Firebase Hosting version');
  return version;
}

async function restoreHosting(site, versionName) {
  await firebaseRequest(`sites/${encodeURIComponent(site)}/channels/live/releases?versionName=${encodeURIComponent(versionName)}`, { method: 'POST' });
}

function restoreTraffic({ project, region, service, trafficMap }) {
  gcloud(['run', 'services', 'update-traffic', service, '--project', project, '--region', region,
    `--to-revisions=${trafficMap}`, '--quiet']);
}

async function main() {
  const project = requireValue('PROJECT_ID', process.env.PROJECT_ID);
  const region = requireValue('REGION', process.env.REGION);
  const service = requireValue('SERVICE_NAME', process.env.SERVICE_NAME);
  const site = requireValue('FIREBASE_SITE', process.env.FIREBASE_SITE);
  const sha = requireValue('ACCEPTED_SHA', process.env.ACCEPTED_SHA);
  const buildServiceAccount = requireValue('GCP_BUILD_SERVICE_ACCOUNT', process.env.GCP_BUILD_SERVICE_ACCOUNT);
  const runtimeServiceAccount = requireValue('GCP_RUNTIME_SERVICE_ACCOUNT', process.env.GCP_RUNTIME_SERVICE_ACCOUNT);
  const firebaseToolsVersion = requireValue('FIREBASE_TOOLS_VERSION', process.env.FIREBASE_TOOLS_VERSION);
  const candidateOnlyInput = requireValue('CANDIDATE_ONLY', process.env.CANDIDATE_ONLY);
  if (!['true', 'false'].includes(candidateOnlyInput)) throw new Error('CANDIDATE_ONLY must be true or false');
  const candidateOnly = candidateOnlyInput === 'true';
  const requestedCandidateRevision = (process.env.CANDIDATE_REVISION || '').trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('ACCEPTED_SHA must be a lowercase 40-character commit SHA');

  const shortSha = sha.slice(0, 12);
  const candidateTag = `candidate-${shortSha}`;
  const revisionSuffix = `r${shortSha}`;
  const expectedCandidateRevision = `${service}-${revisionSuffix}`;
  if (candidateOnly && requestedCandidateRevision) throw new Error('CANDIDATE_REVISION must be empty for a candidate-only run');
  if (!candidateOnly && requestedCandidateRevision !== expectedCandidateRevision) {
    throw new Error(`promotion requires exact candidate revision ${expectedCandidateRevision}`);
  }
  const evidence = {
    acceptedSha: sha,
    reviewUrl: process.env.INDEPENDENT_REVIEW_URL,
    ciRunUrl: process.env.CI_RUN_URL,
    startedAt: new Date().toISOString(),
    previous: {},
    candidate: {},
    smokes: [],
    recovery: [],
    status: 'started',
  };

  let promoted = false;
  let frontendAttempted = false;
  let previousTraffic = '';
  let previousHostingVersion = '';

  try {
    const previousService = describeService(project, region, service);
    previousTraffic = exactTrafficMap(previousService);
    previousHostingVersion = await currentHostingVersion(site);
    evidence.previous = {
      cloudRunTraffic: previousService.status.traffic,
      cloudRunUrl: previousService.status.url,
      firebaseHostingVersion: previousHostingVersion,
    };
    writeEvidence(evidence);

    let candidateRevision = requestedCandidateRevision;
    if (candidateOnly) {
      candidateRevision = gcloud([
        'run', 'deploy', service,
        '--source=.', `--project=${project}`, `--region=${region}`,
        '--no-traffic', `--tag=${candidateTag}`, `--revision-suffix=${revisionSuffix}`,
        `--service-account=${runtimeServiceAccount}`,
        `--build-service-account=projects/${project}/serviceAccounts/${buildServiceAccount}`,
        `--update-env-vars=APP_REVISION=${sha}`, '--quiet',
        '--format=value(status.latestCreatedRevisionName)',
      ]);
      if (candidateRevision !== expectedCandidateRevision) {
        throw new Error(`Cloud Run returned unexpected candidate revision ${candidateRevision || '(empty)'}`);
      }
    }

    const candidateService = describeService(project, region, service);
    const candidateUrl = assertCandidateTraffic(candidateService, candidateRevision, candidateTag);
    evidence.candidate = { revision: candidateRevision, tag: candidateTag, url: candidateUrl };
    evidence.smokes.push({ target: 'candidate', ...(await smokeDeployment(candidateUrl, sha)) });
    writeEvidence(evidence);

    if (candidateOnly) {
      evidence.status = 'candidate-verified';
      evidence.completedAt = new Date().toISOString();
      writeEvidence(evidence);
      console.log(`Verified zero-traffic candidate ${candidateRevision}. Run local authenticated role tests before promotion.`);
      return;
    }

    promoted = true;
    gcloud(['run', 'services', 'update-traffic', service, `--project=${project}`, `--region=${region}`,
      `--to-revisions=${candidateRevision}=100`, '--quiet']);
    const promotedService = describeService(project, region, service);
    assertPromotedTraffic(promotedService, candidateRevision);
    evidence.smokes.push({ target: 'cloud-run-live', ...(await smokeDeployment(promotedService.status.url, sha)) });
    writeEvidence(evidence);

    frontendAttempted = true;
    command('npx', ['--yes', `firebase-tools@${firebaseToolsVersion}`, 'deploy', `--only=hosting:${site}`,
      `--project=${project}`, '--non-interactive']);
    evidence.smokes.push({ target: 'firebase-live', ...(await smokeDeployment(`https://${site}.web.app`, sha)) });

    evidence.status = 'released';
    evidence.completedAt = new Date().toISOString();
    writeEvidence(evidence);
    console.log(`Released ${sha} as Cloud Run revision ${candidateRevision}; Firebase Hosting verified.`);
  } catch (releaseError) {
    evidence.status = 'failed';
    evidence.failure = releaseError instanceof Error ? releaseError.message : String(releaseError);
    const recoveryErrors = [];

    if (frontendAttempted && previousHostingVersion) {
      try {
        await restoreHosting(site, previousHostingVersion);
        evidence.recovery.push({ target: 'firebase-hosting', restoredVersion: previousHostingVersion, ok: true });
      } catch (error) {
        recoveryErrors.push(error);
        evidence.recovery.push({ target: 'firebase-hosting', ok: false, error: error.message });
      }
    }
    if (promoted && previousTraffic) {
      try {
        restoreTraffic({ project, region, service, trafficMap: previousTraffic });
        const restoredTraffic = exactTrafficMap(describeService(project, region, service));
        if (restoredTraffic !== previousTraffic) throw new Error('Cloud Run recovery traffic does not match the captured split');
        evidence.recovery.push({ target: 'cloud-run-traffic', restoredTraffic: previousTraffic, ok: true });
      } catch (error) {
        recoveryErrors.push(error);
        evidence.recovery.push({ target: 'cloud-run-traffic', ok: false, error: error.message });
      }
    }

    evidence.completedAt = new Date().toISOString();
    writeEvidence(evidence);
    if (recoveryErrors.length) {
      throw new AggregateError([releaseError, ...recoveryErrors], 'release failed and automatic recovery was incomplete');
    }
    throw releaseError;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
