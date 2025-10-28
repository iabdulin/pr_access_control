import { createHmac, timingSafeEqual, createSign } from 'crypto';
import { request } from 'https';

// --- CONFIGURATION ---
// These are the approver lists from the document.
// You can update them here as needed.
const JUMP_APPROVERS = ['ptaffet-jump', 'topointon-jump', '0x0ece', 'lidatong', 'ripatel-fd', 'benhawkins18', 'jacobcreech'];
const ANZA_APPROVERS = ['t-nelson', 'sakridge', 'bw-solana', 'benhawkins18', 'jacobcreech'];

// --- ENVIRONMENT VARIABLES ---
// These must be set in your Vercel project settings.
const {
  GITHUB_APP_ID,       // Your GitHub App's ID
  GITHUB_WEBHOOK_SECRET, // Your GitHub App's webhook secret
  GITHUB_PRIVATE_KEY,  // Your App's private key, base64-encoded
} = process.env;

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

  try {
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
  const commentBody = `
Hello @${pr.user.login}! Welcome to the SIMD process.

This PR requires the following approvals before it can be merged:
- At least one approval from a **Jump** team member.
- At least one approval from an **Anza** team member.

Once all requirements are met, you can merge this PR by commenting \`/merge\`.
  `;
  await api.postComment(pr.comments_url, commentBody);
}

/**
 * Handles 'pull_request_review' (submitted) events.
 * Checks approval status and posts an update.
 */
async function handlePullRequestReview(payload, api) {
  const pr = payload.pull_request;
  const review = payload.review;

  // Re-check all approvals
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

  // 1. Is it a /merge command?
  if (!comment.body.trim().startsWith('/merge')) {
    return; // Not a merge command
  }

  // 2. Was it from the PR author?
  if (commenter !== prAuthor) {
    await api.postComment(
      payload.issue.comments_url,
      `@${commenter} Only the PR author (@${prAuthor}) can run the \`/merge\` command.`
    );
    return;
  }

  // 3. Re-fetch PR details to be safe
  const pr = await api.getPR(payload.issue.pull_request.url);

  // 4. Check approval status
  const status = await checkApprovalStatus(pr, api);

  if (status.jumpOk && status.anzaOk) {
    // 5. All clear! Merge the PR.
    try {
      await api.mergePR(pr.url);
      await api.postComment(
        pr.comments_url,
        `✅ Merge successful! @${prAuthor}'s PR has been merged.`
      );
    } catch (e) {
      await api.postComment(
        pr.comments_url,
        `Merge failed: \`${e.message}\`.`
      );
    }
  } else {
    // 6. Missing approvals. Post an error.
    let missing = [];
    if (!status.jumpOk) missing.push('**Jump**');
    if (!status.anzaOk) missing.push('**Anza**');
    let blocked = [];
    if (status.jumpBlockedBy.length > 0) blocked.push(`**Jump** (by ${status.jumpBlockedBy.join(', ')})`);
    if (status.anzaBlockedBy.length > 0) blocked.push(`**Anza** (by ${status.anzaBlockedBy.join(', ')})`);

    let errorMsg = `@${prAuthor}, merge failed. `;
    if (missing.length) errorMsg += `Missing approval from: ${missing.join(', ')}. `;
    if (blocked.length) errorMsg += `PR is blocked by: ${blocked.join(', ')}.`;
    
    await api.postComment(pr.comments_url, errorMsg);
  }
}

// --- CORE APPROVAL LOGIC ---

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
    status[u] = status[u] || { approved: false, blocked: false };

    switch (r.state.toUpperCase()) {
      case 'APPROVED':
        status[u].approved = true;
        status[u].blocked = false; // Approval clears their own block
        break;
      case 'REQUEST_CHANGES':
        status[u].approved = false; // Block clears their own approval
        status[u].blocked = true;
        break;
      case 'DISMISSED':
        status[u].approved = false;
        break;
      // 'commented', 'pending' are ignored
    }
  }

  // Get final lists of who approved and who blocked
  const approvedUsers = Object.entries(status)
    .filter(([, s]) => s.approved && !s.blocked)
    .map(([u]) => u);
  
  const jumpBlockedBy = JUMP_APPROVERS.filter(u => status[u]?.blocked);
  const anzaBlockedBy = ANZA_APPROVERS.filter(u => status[u]?.blocked);

  // Check group status
  const hasJumpApproval = JUMP_APPROVERS.some(u => approvedUsers.includes(u));
  const hasAnzaApproval = ANZA_APPROVERS.some(u => approvedUsers.includes(u));

  return {
    jumpOk: hasJumpApproval && jumpBlockedBy.length === 0,
    anzaOk: hasAnzaApproval && anzaBlockedBy.length === 0,
    jumpBlockedBy,
    anzaBlockedBy,
  };
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
    const url = new URL(commentsUrl);
    return this.apiCall(
      'POST',
      url.pathname,
      { body }
    );
  }

  async getReviews(reviewsUrl) {
    const url = new URL(reviewsUrl);
    // Add per_page to ensure we get all reviews
    url.searchParams.set('per_page', '100');
    return this.apiCall('GET', url.pathname + url.search);
  }
  
  async getPR(prUrl) {
    const url = new URL(prUrl);
    return this.apiCall('GET', url.pathname);
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
              resolve(json);
            } else {
              reject(new Error(`API Error: ${res.statusCode} ${json.message || data}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse API response: ${data}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
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

