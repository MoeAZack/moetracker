#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { validateReleasePolicy } from './policy.mjs';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const acceptedSha = process.env.ACCEPTED_SHA || '';
const token = process.env.GH_TOKEN || '';
if (!token) throw new Error('GH_TOKEN is required for exact-head and CI verification');

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub release verification failed with ${response.status}`);
  return response.json();
}

const mainRef = await github('/repos/MoeAZack/moetracker/git/ref/heads/main');
const mainSha = mainRef?.object?.sha || '';
const runs = await github(`/repos/MoeAZack/moetracker/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&head_sha=${acceptedSha}&per_page=10`);
const ciRun = runs.workflow_runs?.find(run => run.head_sha === acceptedSha && run.head_branch === 'main' && run.event === 'push' && run.conclusion === 'success');
if (!ciRun) throw new Error('accepted SHA has no successful main push run for ci.yml');

let isMainAncestor = false;
try {
  execFileSync('git', ['merge-base', '--is-ancestor', acceptedSha, 'HEAD'], { stdio: 'ignore' });
  isMainAncestor = true;
} catch {
  // Policy validation emits the stable, non-secret failure message.
}

validateReleasePolicy({
  acceptedSha,
  checkoutSha: git('rev-parse', 'HEAD'),
  mainSha,
  isMainAncestor,
  reviewUrl: process.env.INDEPENDENT_REVIEW_URL,
  reviewAccepted: process.env.INDEPENDENT_REVIEW_ACCEPTED,
  githubRepository: process.env.GITHUB_REPOSITORY,
  githubRepositoryId: process.env.GITHUB_REPOSITORY_ID,
  githubOwnerId: process.env.GITHUB_REPOSITORY_OWNER_ID,
  githubRef: process.env.GITHUB_REF,
  githubEventName: process.env.GITHUB_EVENT_NAME,
  githubWorkflowRef: process.env.GITHUB_WORKFLOW_REF,
  workloadIdentityProvider: process.env.GCP_WORKLOAD_IDENTITY_PROVIDER,
  deployServiceAccount: process.env.GCP_DEPLOY_SERVICE_ACCOUNT,
  buildServiceAccount: process.env.GCP_BUILD_SERVICE_ACCOUNT,
  runtimeServiceAccount: process.env.GCP_RUNTIME_SERVICE_ACCOUNT,
  projectId: process.env.PROJECT_ID,
});

if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `CI_RUN_URL=${ciRun.html_url}\n`);
console.log(`Release preflight accepted exact main SHA ${acceptedSha} with successful CI run ${ciRun.id}.`);
