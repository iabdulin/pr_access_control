// https://pr-access-control.vercel.app/api/bot

import { verifyWebhookSignature } from '../lib/utils.js';
import { GitHubAPI } from '../lib/github-api.js';
import { handlePullRequestOpened, handlePullRequestReview, handleIssueComment } from '../lib/handlers.js';

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
  console.log('====================================');
  console.log(`[${event}#${payload.action || 'none'}] installation=${payload.installation?.id || 'none'}`);

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
