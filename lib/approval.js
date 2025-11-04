import { JUMP_APPROVERS, ANZA_APPROVERS } from './config.js';

/**
 * Builds a formatted status message based on approval status.
 */
export function buildStatusMessage(status) {
  if (status.jumpOk && status.anzaOk) {
    return '✅ **Status:** Ready to merge';
  }

  let missing = [];
  if (!status.jumpOk) {
    const jumpList = JUMP_APPROVERS.map(u => `@${u}`).join(', ');
    missing.push(`**Jump** (${jumpList})`);
  }
  if (!status.anzaOk) {
    const anzaList = ANZA_APPROVERS.map(u => `@${u}`).join(', ');
    missing.push(`**Anza** (${anzaList})`);
  }

  let blocked = [];
  if (status.jumpBlockedBy.length > 0) {
    blocked.push(`**Jump** (by ${status.jumpBlockedBy.map(u => `@${u}`).join(', ')})`);
  }
  if (status.anzaBlockedBy.length > 0) {
    blocked.push(`**Anza** (by ${status.anzaBlockedBy.map(u => `@${u}`).join(', ')})`);
  }

  let statusMsg = '⚠️ **Status:** Cannot merge yet\n';
  if (missing.length) statusMsg += `- Missing approval from: ${missing.join(', ')}\n`;
  if (blocked.length) statusMsg += `- Blocked by: ${blocked.join(', ')}`;

  return statusMsg;
}

/**
 * Checks the approval status of a PR.
 * This logic is adapted from the require-jump-anza.yml script.
 */
export async function checkApprovalStatus(pr, api) {
  const reviews = await api.getReviews(pr.reviews_url);
  const requestedReviewers = pr.requested_reviewers?.map(r => r.login) || [];
  const status = {}; // login -> { approved: false, blocked: false }

  console.log(`[approval] Processing ${reviews.length} review(s)`);
  console.log(`[approval] Requested reviewers:`, requestedReviewers);

  // Replay all review events to find the latest state for each user
  for (const r of reviews) {
    const u = r.user.login;
    const reviewState = r.state.toUpperCase();

    console.log(`[approval] @${u}: ${reviewState} (id: ${r.id}, submitted: ${r.submitted_at})`);

    status[u] = status[u] || { approved: false, blocked: false };

    // If this user is in requested_reviewers, they need to re-review
    // Skip processing their old reviews
    if (requestedReviewers.includes(u)) {
      console.log(`[approval] @${u} is in requested_reviewers, skipping old review`);
      status[u].approved = false;
      status[u].blocked = false;
      continue;
    }

    switch (reviewState) {
      case 'APPROVED':
        status[u].approved = true;
        status[u].blocked = false;
        break;
      case 'CHANGES_REQUESTED':
        status[u].approved = false;
        status[u].blocked = true;
        break;
      case 'DISMISSED':
        status[u].approved = false;
        status[u].blocked = false;
        break;
      case 'COMMENTED':
        // Commenting doesn't change approval/block state
        break;
      case 'PENDING':
        // Pending review clears previous approval/block
        status[u].approved = false;
        status[u].blocked = false;
        break;
      default:
        console.log(`[approval] WARNING: Unknown review state: ${reviewState}`);
    }
  }

  // Get final lists of who approved and who blocked
  const approvedUsers = Object.entries(status)
    .filter(([, s]) => s.approved && !s.blocked)
    .map(([u]) => u);

  const jumpBlockedBy = JUMP_APPROVERS.filter(u => status[u]?.blocked);
  const anzaBlockedBy = ANZA_APPROVERS.filter(u => status[u]?.blocked);

  const jumpApprovers = JUMP_APPROVERS.filter(u => approvedUsers.includes(u));
  const anzaApprovers = ANZA_APPROVERS.filter(u => approvedUsers.includes(u));

  const hasJumpApproval = jumpApprovers.length > 0;
  const hasAnzaApproval = anzaApprovers.length > 0;

  const result = {
    jumpOk: hasJumpApproval && jumpBlockedBy.length === 0,
    anzaOk: hasAnzaApproval && anzaBlockedBy.length === 0,
    jumpBlockedBy,
    anzaBlockedBy,
  };

  // Log concise approval summary
  console.log(`[approval] Jump: ${hasJumpApproval ? '✅' : '❌'} ${jumpApprovers.join(', ') || 'none'}${jumpBlockedBy.length ? ` (blocked by: ${jumpBlockedBy.join(', ')})` : ''}`);
  console.log(`[approval] Anza: ${hasAnzaApproval ? '✅' : '❌'} ${anzaApprovers.join(', ') || 'none'}${anzaBlockedBy.length ? ` (blocked by: ${anzaBlockedBy.join(', ')})` : ''}`);

  return result;
}
