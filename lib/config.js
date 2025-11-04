// --- CONFIGURATION ---
// These are the approver lists from the document.
// You can update them here as needed.

// Production approvers
// export const JUMP_APPROVERS = ['ptaffet-jump', 'topointon-jump', '0x0ece', 'lidatong', 'ripatel-fd', 'benhawkins18', 'jacobcreech'];
// export const ANZA_APPROVERS = ['t-nelson', 'sakridge', 'bw-solana', 'benhawkins18', 'jacobcreech'];

// Test approvers
export const JUMP_APPROVERS = ['iabdulin2', 'alex-at-planetariummusic', 'nickfarina', 'benhawkins18', 'iabdulin-bee'];
export const ANZA_APPROVERS = ['iabdulin3', 'iabdulin', 'patlanio', 'holahoon', 'iabdulin-bee'];

// --- ENVIRONMENT VARIABLES ---
// These must be set in your Vercel project settings.
export const {
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
