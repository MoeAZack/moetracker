const SHA_RE = /^[0-9a-f]{40}$/;
const REVIEW_RE = /^https:\/\/github\.com\/MoeAZack\/moetracker\/(?:pull|issues)\/\d+#(?:issuecomment|pullrequestreview)-\d+$/;
const WIF_RE = /^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/;

export function requireValue(name, value) {
  if (!value || !String(value).trim()) throw new Error(`${name} is required`);
  return String(value).trim();
}

export function validateReleasePolicy(input) {
  const acceptedSha = requireValue('ACCEPTED_SHA', input.acceptedSha);
  const checkoutSha = requireValue('checked-out SHA', input.checkoutSha);
  const mainSha = requireValue('origin/main SHA', input.mainSha);
  const reviewUrl = requireValue('INDEPENDENT_REVIEW_URL', input.reviewUrl);

  if (!SHA_RE.test(acceptedSha)) throw new Error('ACCEPTED_SHA must be a lowercase 40-character commit SHA');
  if (checkoutSha !== acceptedSha) throw new Error('checked-out commit does not equal ACCEPTED_SHA');
  if (mainSha !== acceptedSha) throw new Error('ACCEPTED_SHA is not the exact current origin/main head');
  if (input.isMainAncestor !== true) throw new Error('ACCEPTED_SHA is not an ancestor of origin/main');
  if (String(input.reviewAccepted) !== 'true') throw new Error('independent review attestation was not accepted');
  if (!REVIEW_RE.test(reviewUrl)) throw new Error('INDEPENDENT_REVIEW_URL must point to a review or comment on this repository');
  if (input.githubRepository !== 'MoeAZack/moetracker' || input.githubRepositoryId !== '1300351996' || input.githubOwnerId !== '279140809') {
    throw new Error('GitHub repository identity does not match the release trust boundary');
  }
  if (input.githubRef !== 'refs/heads/main' || input.githubEventName !== 'workflow_dispatch') {
    throw new Error('release must be manually dispatched from main');
  }
  if (input.githubWorkflowRef !== 'MoeAZack/moetracker/.github/workflows/deploy-once.yml@refs/heads/main') {
    throw new Error('workflow identity does not match the trusted release workflow on main');
  }

  const provider = requireValue('GCP_WORKLOAD_IDENTITY_PROVIDER', input.workloadIdentityProvider);
  if (!WIF_RE.test(provider)) throw new Error('GCP_WORKLOAD_IDENTITY_PROVIDER has an invalid resource name');

  for (const [name, value] of [
    ['GCP_DEPLOY_SERVICE_ACCOUNT', input.deployServiceAccount],
    ['GCP_BUILD_SERVICE_ACCOUNT', input.buildServiceAccount],
    ['GCP_RUNTIME_SERVICE_ACCOUNT', input.runtimeServiceAccount],
  ]) {
    const serviceAccount = requireValue(name, value);
    if (!serviceAccount.endsWith(`@${input.projectId}.iam.gserviceaccount.com`)) {
      throw new Error(`${name} must belong to ${input.projectId}`);
    }
  }

  if (input.deployServiceAccount === input.buildServiceAccount || input.deployServiceAccount === input.runtimeServiceAccount) {
    throw new Error('deploy, build, and runtime identities must be separated');
  }
  if (input.buildServiceAccount === input.runtimeServiceAccount) {
    throw new Error('build and runtime identities must be separated');
  }

  return { acceptedSha, reviewUrl, provider };
}

export function exactTrafficMap(service) {
  const entries = service?.status?.traffic;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('Cloud Run has no traffic state to preserve');
  const positive = entries.filter(entry => Number(entry.percent || 0) > 0);
  if (positive.length === 0 || positive.some(entry => !entry.revisionName)) {
    throw new Error('Cloud Run traffic is not pinned to named revisions');
  }
  const total = positive.reduce((sum, entry) => sum + Number(entry.percent), 0);
  if (total !== 100) throw new Error(`Cloud Run traffic percentages total ${total}, not 100`);
  return positive.map(entry => `${entry.revisionName}=${entry.percent}`).join(',');
}

export function assertCandidateTraffic(service, candidateRevision, candidateTag) {
  const traffic = service?.status?.traffic || [];
  const tagged = traffic.find(entry => entry.tag === candidateTag);
  if (!tagged?.url) throw new Error('candidate tag URL was not created');
  if (tagged.revisionName !== candidateRevision) throw new Error('candidate tag does not resolve to the deployed revision');
  const candidatePercent = traffic
    .filter(entry => entry.revisionName === candidateRevision)
    .reduce((sum, entry) => sum + Number(entry.percent || 0), 0);
  if (candidatePercent !== 0) throw new Error('candidate received normal traffic before promotion');
  return tagged.url;
}

export function assertPromotedTraffic(service, candidateRevision) {
  const positive = (service?.status?.traffic || []).filter(entry => Number(entry.percent || 0) > 0);
  if (positive.length !== 1 || positive[0].revisionName !== candidateRevision || Number(positive[0].percent) !== 100) {
    throw new Error('Cloud Run did not promote exactly the candidate revision to 100%');
  }
}
