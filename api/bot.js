// test comment1
// https://pr-access-control.vercel.app/api/bot

import { createHmac, timingSafeEqual, createSign } from 'crypto';
import { request } from 'https';

// --- CONFIGURATION ---
// These are the approver lists from the document.
// You can update them here as needed.

// Production approvers
// const JUMP_APPROVERS = ['ptaffet-jump', 'topointon-jump', '0x0ece', 'lidatong', 'ripatel-fd', 'benhawkins18', 'jacobcreech'];
// const ANZA_APPROVERS = ['t-nelson', 'sakridge', 'bw-solana', 'benhawkins18', 'jacobcreech'];
const JUMP_APPROVERS = ['iabdulin2', 'alex-at-planetariummusic', 'nickfarina', 'benhawkins18', 'iabdulin-bee'];
const ANZA_APPROVERS = ['iabdulin3', 'iabdulin', 'patlanio', 'holahoon', 'iabdulin-bee'];

// Test approvers - add your test GitHub usernames here
// Uncomment and add your test accounts when testing:
// const JUMP_APPROVERS = ['test-jump-approver', 'iabdulin'];
// const ANZA_APPROVERS = ['test-anza-approver', 'iabdulin'];

// --- ENVIRONMENT VARIABLES ---
// These must be set in your Vercel project settings.
const {
  GITHUB_APP_ID,       // Your GitHub App's ID
  GITHUB_WEBHOOK_SECRET, // Your GitHub App's webhook secret
  GITHUB_PRIVATE_KEY,  // Your App's private key, base64-encoded
} = process.env;

// Startup logging - only when missing config
if (!GITHUB_APP_ID || !GITHUB_WEBHOOK_SECRET || !GITHUB_PRIVATE_KEY) {
  console.error('ERROR: Missing required environment variables');
  console.error('GITHUB_APP_ID:', GITHUB_APP_ID ? 'Set' : 'MISSING');
  console.error('GITHUB_WEBHOOK_SECRET:', GITHUB_WEBHOOK_SECRET ? 'Set' : 'MISSING');
  console.error('GITHUB_PRIVATE_KEY:', GITHUB_PRIVATE_KEY ? 'Set' : 'MISSING');
}

// --- VERCEL CONFIG ---
// Disable Vercel's automatic body parser to get the raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

// --- HELPER TO READ RAW BODY ---
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', (err) => reject(err));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

// --- MAIN HANDLER ---
// This is the Vercel serverless function entry point.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // Read the raw body
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    console.error('Error reading request body:', error.message);
    return res.status(400).json({ message: 'Could not read request body' });
  }

  // 1. Verify the webhook signature
  try {
    const signature = req.headers['x-hub-signature-256'];

    if (!verifyWebhookSignature(signature, rawBody)) {
      console.warn('Invalid webhook signature');
      return res.status(401).json({ message: 'Invalid signature' });
    }
  } catch (error) {
    console.error('Error verifying webhook:', error.message);
    return res.status(400).json({ message: 'Webhook verification failed' });
  }

  // 2. Route the event to the correct handler
  const event = req.headers['x-github-event'];
  const payload = JSON.parse(rawBody);
  console.log(`[${event}] action=${payload.action || 'none'} installation=${payload.installation?.id || 'none'}`);

  try {
    if (!payload.installation?.id) {
      console.error('[ERROR] No installation ID found in payload');
      return res.status(400).json({ message: 'No installation ID found' });
    }
    const api = new GitHubAPI(payload.installation.id);
    let promise;

    switch (event) {
      case 'pull_request':
        if (payload.action === 'opened') {
          promise = handlePullRequestOpened(payload, api);
        }
        break;
      case 'pull_request_review':
        if (payload.action === 'submitted') {
          promise = handlePullRequestReview(payload, api);
        }
        break;
      case 'issue_comment':
        if (payload.action === 'created' && payload.issue.pull_request) {
          promise = handleIssueComment(payload, api);
        }
        break;
      default:
        // Not an event we care about, return 200 to acknowledge
        return res.status(200).json({ message: 'Event received' });
    }

    // Await the handler's promise
    if (promise) {
      await promise;
    }

    return res.status(200).json({ message: 'Event handled successfully' });
  } catch (error) {
    console.error('Error handling event:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

// --- EVENT HANDLERS ---

/**
 * Handles 'pull_request' (opened) events.
 * Posts a welcome comment with approval requirements.
 */
async function handlePullRequestOpened(payload, api) {
  const pr = payload.pull_request;
  const jumpList = JUMP_APPROVERS.map(u => `@${u}`).join(', ');
  const anzaList = ANZA_APPROVERS.map(u => `@${u}`).join(', ');

  const commentBody = `
Hello @${pr.user.login}! Welcome to the SIMD process.

This PR requires the following approvals before it can be merged:
- At least one approval from a **Jump** team member: ${jumpList}
- At least one approval from an **Anza** team member: ${anzaList}

Once all requirements are met, you can merge this PR by commenting \`/merge\`.
  `;
  await api.postComment(pr.comments_url, commentBody);
}

/**
 * Handles 'pull_request_review' (submitted) events.
 * Checks approval status and posts an update.
 */
async function handlePullRequestReview(payload, api) {
  const review = payload.review;
  console.log(`[review] @${review.user.login} ${review.state} on PR#${payload.pull_request.number}`);

  const pr = await api.getPR(payload.pull_request.url);
  const status = await checkApprovalStatus(pr, api);

  if (review.state === 'changes_requested') {
    // 1. Handle "Request Changes"
    await api.postComment(
      pr.comments_url,
      `⛔ Merge blocked. @${review.user.login} has requested changes.`
    );
  } else if (review.state === 'approved') {
    // 2. Handle "Approved"
    if (status.jumpOk && status.anzaOk) {
      await api.postComment(
        pr.comments_url,
        `✅ All approvals received! @${pr.user.login}, you can now merge this by commenting \`/merge\`.`
      );
    } else {
      let missing = [];
      if (!status.jumpOk) missing.push('**Jump**');
      if (!status.anzaOk) missing.push('**Anza**');
      await api.postComment(
        pr.comments_url,
        `Thanks, @${review.user.login}! Still awaiting approval from the ${missing.join(' and ')} group(s).`
      );
    }
  }
  // No action needed for 'commented' state
}

/**
 * Handles 'issue_comment' (created) events.
 * Listens for /merge commands.
 */
async function handleIssueComment(payload, api) {
  const comment = payload.comment;
  const prAuthor = payload.issue.user.login;
  const commenter = comment.user.login;
  const trimmedBody = comment.body.trim();

  // 1. Check if it's a command (starts with /)
  if (!trimmedBody.startsWith('/')) {
    return; // Not a command
  }

  const command = trimmedBody.split(/\s+/)[0];
  console.log(`[command] ${command} by @${commenter} on PR#${payload.issue.number}`);

  // 2. Fetch PR details and check approval status
  const pr = await api.getPR(payload.issue.pull_request.url);
  const status = await checkApprovalStatus(pr, api);

  // 3. Check if it's a valid command
  if (command !== '/merge') {
    const statusMsg = buildStatusMessage(status);
    await api.postComment(
      payload.issue.comments_url,
      `@${commenter} Invalid command: \`${command}\`. Available commands: \`/merge\`\n\n${statusMsg}`
    );
    return;
  }

  // 4. Was it from the PR author?
  if (commenter !== prAuthor) {
    const statusMsg = buildStatusMessage(status);
    await api.postComment(
      payload.issue.comments_url,
      `@${commenter} Only the PR author (@${prAuthor}) can run the \`/merge\` command.\n\n${statusMsg}`
    );
    return;
  }

  if (status.jumpOk && status.anzaOk) {
    // 5. All clear! Merge the PR.
    console.log(`[merge] Attempting merge PR#${payload.issue.number} (state=${pr.mergeable_state}, mergeable=${pr.mergeable})`);

    try {
      // Check if PR is in a mergeable state
      if (pr.mergeable === false) {
        throw new Error('PR has merge conflicts that must be resolved first');
      }
      if (pr.mergeable_state === 'blocked') {
        throw new Error(`PR is blocked (state: ${pr.mergeable_state})`);
      }

      await api.mergePR(pr.url);
      console.log(`[merge] ✅ Successfully merged PR#${payload.issue.number}`);
      await api.postComment(
        pr.comments_url,
        `✅ Merge successful! @${prAuthor}'s PR has been merged.`
      );
    } catch (e) {
      console.error(`[merge] ❌ Failed: ${e.message}`);
      let errorMsg = `Merge failed: \`${e.message}\``;

      // Provide helpful hints based on the error
      if (e.message.includes('Resource not accessible by integration')) {
        errorMsg += '\n\n**Possible causes:**\n';
        errorMsg += '- GitHub App needs "Contents: Read and write" permission\n';
        errorMsg += '- Branch protection rules may be blocking the merge\n';
        errorMsg += '- Check repository Settings → GitHub Apps for permission requests';
      } else if (e.message.includes('405')) {
        errorMsg += '\n\nThe PR may not be in a mergeable state (conflicts, checks failing, etc.)';
      } else if (e.message.includes('blocked')) {
        errorMsg += `\n\nPR mergeable state: \`${pr.mergeable_state}\``;
        errorMsg += '\n\nCheck Settings → Branches or Settings → Rules for protection rules.';
      }

      await api.postComment(pr.comments_url, errorMsg);
    }
  } else {
    // 6. Missing approvals. Post an error.
    const statusMsg = buildStatusMessage(status);
    await api.postComment(pr.comments_url, `@${prAuthor} ${statusMsg}`);
  }
}

// --- CORE APPROVAL LOGIC ---

/**
 * Builds a formatted status message based on approval status.
 */
function buildStatusMessage(status) {
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
async function checkApprovalStatus(pr, api) {
  const reviews = await api.getReviews(pr.reviews_url);
  const status = {}; // login -> { approved: false, blocked: false }

  // Replay all review events to find the latest state for each user
  for (const r of reviews) {
    const u = r.user.login;
    const reviewState = r.state.toUpperCase();

    status[u] = status[u] || { approved: false, blocked: false };

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

// --- GITHUB API CLIENT ---
// A lightweight client for making authenticated GitHub API calls.
class GitHubAPI {
  constructor(installationId) {
    this.installationId = installationId;
    this._token = null;
    this._tokenExpires = 0;
  }

  async getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (!this._token || this._tokenExpires < (now - 60)) {
      // Token is missing, expired, or expiring soon, get a new one
      const appJwt = generateJwt();
      const tokenData = await this.apiCall(
        'POST',
        `/app/installations/${this.installationId}/access_tokens`,
        null,
        `Bearer ${appJwt}`
      );
      this._token = tokenData.token;
      this._tokenExpires = Date.parse(tokenData.expires_at) / 1000;
    }
    return this._token;
  }

  async postComment(commentsUrl, body) {
    if (!commentsUrl) {
      throw new Error('postComment: commentsUrl is undefined or null');
    }
    const url = new URL(commentsUrl);
    return this.apiCall('POST', url.pathname, { body });
  }

  async getReviews(reviewsUrl) {
    if (!reviewsUrl) {
      throw new Error('getReviews: reviewsUrl is undefined or null');
    }
    const url = new URL(reviewsUrl);
    url.searchParams.set('per_page', '100');
    return this.apiCall('GET', url.pathname + url.search);
  }

  async getStatusChecks(prUrl) {
    if (!prUrl) {
      throw new Error('getStatusChecks: prUrl is undefined or null');
    }
    const url = new URL(prUrl);
    const statusPath = `${url.pathname}/commits/${await this.getHeadSha(prUrl)}/status`;
    return this.apiCall('GET', statusPath);
  }

  async getHeadSha(prUrl) {
    const pr = await this.getPR(prUrl);
    return pr.head.sha;
  }

  async getPR(prUrl) {
    if (!prUrl) {
      throw new Error('getPR: prUrl is undefined or null');
    }
    const url = new URL(prUrl);
    const result = await this.apiCall('GET', url.pathname);

    // GitHub API doesn't include reviews_url in the main response
    // Construct it from the PR URL
    if (!result.reviews_url) {
      result.reviews_url = `${result.url}/reviews`;
    }

    return result;
  }

  async mergePR(prUrl) {
    const url = new URL(prUrl);
    // Use commit_title matching the PR title
    const pr = await this.getPR(prUrl);
    const commit_title = `${pr.title} (#${pr.number})`;

    return this.apiCall(
      'PUT',
      `${url.pathname}/merge`,
      {
        commit_title,
        merge_method: 'squash', // Or 'merge' or 'rebase'
      }
    );
  }

  /**
   * Generic, authenticated GitHub API call helper.
   */
  async apiCall(method, path, body = null, overrideAuth = null) {
    const authToken = overrideAuth || `Bearer ${await this.getToken()}`;
    const options = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': authToken,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'SIMD-Merge-Bot',
        'Content-Type': 'application/json',
      },
    };

    return new Promise((resolve, reject) => {
      const req = request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : {};
            if (res.statusCode >= 200 && res.statusCode < 300) {
              console.log(`[api] ${method} ${path} → ${res.statusCode}`);
              resolve(json);
            } else {
              console.error(`[api] ${method} ${path} → ${res.statusCode} ${json.message || ''}`);
              reject(new Error(`API Error: ${res.statusCode} ${json.message || data}`));
            }
          } catch (e) {
            console.error(`[api] Failed to parse response: ${data}`);
            reject(new Error(`Failed to parse API response: ${data}`));
          }
        });
      });

      req.on('error', (e) => {
        console.error(`[api] Request error: ${e.message}`);
        reject(e);
      });
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
}

// --- UTILITY FUNCTIONS ---

/**
 * Verifies the webhook signature from GitHub.
 */
function verifyWebhookSignature(signature, body) {
  if (!signature) {
    throw new Error('No signature provided');
  }
  if (!GITHUB_WEBHOOK_SECRET) {
    throw new Error('GITHUB_WEBHOOK_SECRET is not set');
  }

  const hmac = createHmac('sha256', GITHUB_WEBHOOK_SECRET);
  hmac.update(body); // Vercel provides the raw body
  const expectedSignature = `sha256=${hmac.digest('hex')}`;

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  // Use timingSafeEqual to prevent timing attacks
  return sigBuffer.length === expectedBuffer.length &&
         timingSafeEqual(sigBuffer, expectedBuffer);
}

/**
 * Generates a JSON Web Token (JWT) for GitHub App authentication.
 * This implementation uses only the built-in 'crypto' module.
 */
function generateJwt() {
  if (!GITHUB_PRIVATE_KEY || !GITHUB_APP_ID) {
    throw new Error('Missing GITHUB_PRIVATE_KEY or GITHUB_APP_ID');
  }

  // Decode the base64 private key
  const privateKey = Buffer.from(GITHUB_PRIVATE_KEY, 'base64').toString('ascii');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,      // Issued at time (60s in the past)
    exp: now + (10 * 60), // Expiration time (10 minutes)
    iss: GITHUB_APP_ID,   // Issuer (your App ID)
  };

  // Create the JWT header
  const header = { alg: 'RS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');

  // Create the JWT payload
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

  // Create the signature
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signatureInput);
  const signature = sign.sign(privateKey, 'base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

