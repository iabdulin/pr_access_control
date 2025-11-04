# PR Access Control Bot

A GitHub App that enforces dual-approval requirements for pull requests. This bot ensures PRs receive approvals from both Jump and Anza team members before allowing merge operations.

## Overview

This serverless application runs on Vercel and responds to GitHub webhook events. It implements a custom approval workflow that requires:

- ✅ At least one approval from a **Jump** team member
- ✅ At least one approval from an **Anza** team member
- ⛔ No blocking "Request Changes" reviews from either team

Once these requirements are met, the PR author can merge the changes by typing `/merge` into a comment on the PR.

## Features

- **Dual-approval enforcement**: Requires approvals from both teams
- **Blocking review handling**: Prevents merge when changes are requested
- **Command-based merging**: PR authors merge via `/merge` comment
- **Real-time status updates**: Posts status comments after each review
- **Webhook signature verification**: Ensures requests come from GitHub
- **Zero external dependencies**: Uses only Node.js built-ins

## Architecture

```
┌─────────────┐
│   GitHub    │
│   Webhook   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Vercel Serverless Function         │
│  (api/bot.js)                       │
│                                     │
│  1. Verify webhook signature        │
│  2. Route to event handler          │
│  3. Process approval logic          │
│  4. Post status/merge PR            │
└─────────────────────────────────────┘
```

### File Structure

```
.
├── api/
│   └── bot.js              # Main webhook handler (Vercel entry point)
├── lib/
│   ├── config.js           # Configuration and approver lists
│   ├── handlers.js         # Event handlers (PR opened, review, comment)
│   ├── approval.js         # Approval status checking logic
│   ├── github-api.js       # GitHub API client
│   └── utils.js            # Crypto utilities (JWT, signatures)
└── README.md
```

## How It Works

### 1. Pull Request Opened

When a PR is opened, the bot posts a welcome comment:

```
Hello @author! Welcome to the SIMD process.

This PR requires the following approvals before it can be merged:
- At least one approval from a Jump team member: @user1, @user2...
- At least one approval from an Anza team member: @user3, @user4...

Once all requirements are met, you can merge this PR by typing `/merge` into a comment on this PR.
```

### 2. Review Submitted

When someone submits a review, the bot:

- Fetches all reviews for the PR
- Processes them chronologically to determine current approval state
- Handles special cases:
  - **Request Changes**: Posts a block message
  - **Approve**: Checks if all requirements met
  - **Requested reviewers**: Ignores old reviews from users who need to re-review

### 3. Merge Command

When the PR author comments `/merge`:

- Validates the commenter is the PR author
- Checks approval requirements are met
- Verifies PR is in mergeable state (no conflicts, checks passing)
- Performs squash merge
- Posts success/failure message

## Setup

This guide walks through the complete setup process: creating your GitHub App, deploying to Vercel, connecting them together, and configuring your repository.

### Part 1: Create Your GitHub App

GitHub Apps are the modern, secure way to build automation. Your bot will authenticate as an app with minimal required permissions.

#### 1.1 Navigate to App Settings

1. Go to your GitHub Organization's page
2. Click **Settings** → **Developer settings** (bottom of left sidebar) → **GitHub Apps**
3. Click **New GitHub App**

#### 1.2 Configure Basic Settings

- **App name**: `SIMD Merge Bot` (or your preferred name)
- **Homepage URL**: Your repository URL (e.g., `https://github.com/your-org/simd`)
- **Webhook URL**: **Leave blank for now** (we'll add this after Vercel deployment)

#### 1.3 Generate Webhook Secret

Create a strong, random webhook secret:

```bash
openssl rand -hex 32
```

**Save this secret!** You'll need it for Vercel environment variables.

Enter it in the **Webhook secret** field.

#### 1.4 Set Repository Permissions

This is critical. Scroll to "Repository permissions" and configure:

| Permission        | Access Level     | Why?                                                   |
| ----------------- | ---------------- | ------------------------------------------------------ |
| **Contents**      | **Read & write** | Repository contents, commits, branches, and **merges** |
| **Issues**        | **Read & write** | Issue comments (used for `/merge` command detection)   |
| **Pull requests** | **Read & write** | PR data, reviews, comments, and approval status        |
| All others        | No access        |                                                        |

#### 1.5 Subscribe to Events

Scroll to "Subscribe to events" and check these boxes:

- ☑️ **Issue comment**
- ☑️ **Pull request**
- ☑️ **Pull request review**

#### 1.6 Create the App

1. Under "Where can this app be installed?", select **Only on this account**
2. Click **Create GitHub App**

#### 1.7 Get Your Credentials

After creation, you'll be on the app's settings page:

1. **Note your App ID** (shown at the top)
2. Scroll to "Private keys" section
3. Click **Generate a private key**
4. This downloads a `.pem` file (e.g., `simd-merge-bot.2025-10-23.private-key.pem`)

**Treat this file like a password!** It authenticates your bot.

---

### Part 2: Deploy to Vercel

#### 2.1 Create Vercel Project

1. Create a new project on [Vercel](https://vercel.com)
2. You can link it to this repository or create a new one
3. Ensure your file structure matches:
   ```
   .
   ├── api/
   │   └── bot.js
   └── lib/
       ├── config.js
       ├── handlers.js
       ├── approval.js
       ├── github-api.js
       └── utils.js
   ```

#### 2.2 Prepare Your Private Key

Convert your `.pem` file to a base64-encoded string:

**macOS/Linux:**

```bash
cat /path/to/your/private-key.pem | base64 | tr -d '\n'
```

**Windows PowerShell:**

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\your\private-key.pem"))
```

Copy the resulting long string.

#### 2.3 Configure Environment Variables

In your Vercel project:

1. Go to **Settings** → **Environment Variables**
2. Add these three **Secret** variables:

| Variable                | Value                                |
| ----------------------- | ------------------------------------ |
| `GITHUB_APP_ID`         | Your App ID from Part 1.7            |
| `GITHUB_WEBHOOK_SECRET` | The webhook secret from Part 1.3     |
| `GITHUB_PRIVATE_KEY`    | The base64-encoded key from Part 2.2 |

#### 2.4 Deploy

1. Push your code to the repository
2. Vercel will automatically build and deploy
3. Note your production URL (e.g., `https://my-simd-bot.vercel.app`)

---

### Part 3: Connect GitHub and Vercel

#### 3.1 Update Webhook URL

Now that your Vercel function is deployed:

1. Return to your GitHub App's settings page
2. Find the **Webhook URL** field (left blank in Part 1)
3. Enter your Vercel URL with `/api/bot` appended:
   ```
   https://my-simd-bot.vercel.app/api/bot
   ```
4. Click **Save changes** at the bottom

GitHub will now send webhook events to your Vercel function.

---

### Part 4: Install and Configure

#### 4.1 Install the App on Your Repository

1. On your GitHub App's settings page, click **Install App** (left sidebar)
2. Click **Install** next to your organization
3. Select **Only select repositories**
4. Choose your target repository (e.g., your SIMD repo)
5. Click **Install**

#### 4.2 Configure Branch Protection with Rulesets (Critical!)

This step ensures only the bot can merge to your main branch using GitHub's Rulesets feature:

1. Go to your repository → **Settings** → **Rules** → **Rulesets**
2. Click **New ruleset** → **New branch ruleset**
3. Configure the ruleset:

   - **Ruleset Name**: `Restrict pushes` (or your preferred name)
   - **Enforcement status**: **Active**
   - **Target branches**: Add `Default` branch (or specify `main`)

4. Under **Branch rules**, enable:

   - ☑️ **Restrict creations** - Only allow users with bypass permission to create matching refs
   - ☑️ **Restrict updates** - Only allow users with bypass permission to update matching refs
   - ☑️ **Restrict deletions** - Only allow users with bypass permission to delete matching refs
   - ☑️ **Require a pull request before merging** - Require all commits to be made to a non-target branch and submitted via a pull request

5. Under **Bypass list**, click **Add bypass**:

   - Search for and add your bot (e.g., `SIMD Merge Bot`)
   - Select "Exempt (The ruleset will not be evaluated and no bypass prompt will be shown)"
   - _Optionally_ add organization admins who should have bypass access

6. Click **Create** to save the ruleset

> **Why this matters:** Without these restrictions, anyone with write access can bypass the bot's approval checks by pushing directly or using GitHub's merge button. The bypass list makes the bot (and specified admins) the **only** entities that can merge to the protected branch.

#### 4.3 Configure Approver Lists

Edit `lib/config.js` to set your team members:

```javascript
export const JUMP_APPROVERS = ['user1', 'user2', 'user3']
export const ANZA_APPROVERS = ['user4', 'user5', 'user6']
```

**Important:** Use exact GitHub usernames (case-sensitive).

---

### Part 5: Test Your Bot

Your bot is now live! Test it:

1. Open a new pull request
2. The bot should post a welcome comment with approval requirements
3. Have team members from both groups approve
4. Comment `/merge` to trigger the merge

If something doesn't work, check the [Troubleshooting](#troubleshooting) section below.

## Usage

### For PR Authors

1. Open a pull request
2. Wait for required approvals from both teams
3. When ready, comment `/merge` to merge the PR

### For Reviewers

- **Approve**: If you're satisfied with the changes
- **Request Changes**: If changes are needed (blocks merge)
- **Comment**: For discussion without affecting approval status

## Approval Logic

The bot replays all review events chronologically to determine the current state:

```javascript
APPROVED          → User approves (clears any previous blocks)
CHANGES_REQUESTED → User blocks (clears any previous approvals)
DISMISSED         → Review dismissed (clears both approval and block)
COMMENTED         → No effect on approval state
PENDING           → New review requested (clears previous state)
```

**Special handling:**

- If a user is in `requested_reviewers`, their old reviews are ignored
- Both teams must have at least one approval
- Neither team can have any active blocking reviews

## Example Workflow

```
1. @alice opens PR
   → Bot posts welcome message

2. @bob (Jump) approves
   → Bot posts: "Thanks @bob! Still need: Anza approval"

3. @charlie (Anza) requests changes
   → Bot posts: "⛔ Merge blocked by @charlie"

4. @alice pushes fixes, re-requests review from @charlie
   → @charlie's blocking review is cleared

5. @charlie approves
   → Bot posts: "✅ All approvals received! You can merge with /merge"

6. @alice comments "/merge"
   → Bot merges the PR
```

## Customization

### Change Merge Method

Edit `lib/github-api.js:89`:

```javascript
merge_method: 'squash', // Options: 'merge', 'squash', 'rebase'
```

## Development

### Local Testing

1. Install dependencies: None required! Uses only Node.js built-ins
2. Set environment variables in `.env` file:
   ```bash
   GITHUB_APP_ID=your-app-id
   GITHUB_WEBHOOK_SECRET=your-webhook-secret
   GITHUB_PRIVATE_KEY=your-base64-encoded-private-key
   ```
3. Run the development server:
   ```bash
   vercel dev
   ```
4. Expose your local server to the internet (choose one method):
   - **VS Code Ports feature**: Forward your port and make it public
   - **ngrok**: `ngrok http 3000`
   - **localtunnel**: `npx localtunnel --port 3000`
5. Update your GitHub App's webhook URL to your public URL (e.g., `https://your-tunnel-url.ngrok.io/api/bot`)
6. Test by creating PRs and triggering webhooks in your repository

### Logs

View logs in Vercel dashboard or use:

```bash
vercel logs your-deployment-url
```

Log format:

```
[pull_request#opened] installation=12345
[review] @user approved on PR#10
[approval] Jump: ✅ user1 (blocked by: none)
[approval] Anza: ❌ none (blocked by: none)
[merge] Attempting merge PR#10 (state=clean, mergeable=true)
```

## Troubleshooting

### Bot posts comments but doesn't respond to webhooks

- Check Vercel deployment logs for errors
- Verify the webhook URL in GitHub App settings is correct (ends with `/api/bot`)
- Check that environment variables are set correctly in Vercel

### "Invalid signature" errors

- Verify `GITHUB_WEBHOOK_SECRET` matches your app's webhook secret exactly
- Ensure webhook payload is not modified by proxies or middleware
- Check that the secret is properly set in both GitHub and Vercel

### "Resource not accessible by integration" when merging

- Check app has **"Contents: Read and write"** permission (required for merging)
- Check app has **"Pull requests: Read and write"** permission (required for PR operations)
- Check app has **"Issues: Read and write"** permission (required for posting comments)
- Verify app is installed on the repository (not just the organization)
- Check Rulesets: bot must be in the **Bypass list** (Part 4.2)

### Bot approvals met but merge still fails

- **Most common:** Rulesets not configured (Part 4.2)
  - The bot must be added to the ruleset's **Bypass list**
  - Without this, GitHub blocks the bot from pushing/merging
- Verify PR is in mergeable state (no conflicts)
- Check that required status checks (if any) are passing
- Ensure the PR is up to date with base branch
- Look for multiple rulesets that might conflict

### Merge fails with "blocked" state

- Check Settings → Rules → Rulesets for active rules
- Verify the bot is in the Bypass list for all relevant rulesets
- Check for required status checks that aren't passing
- Ensure the PR is up to date with base branch
- Check if there are CODEOWNERS rules blocking
- Look for organization-level rulesets that might apply

### Reviews not being counted

- Verify usernames in `JUMP_APPROVERS`/`ANZA_APPROVERS` match exactly (case-sensitive)
- Check if reviewer is in `requested_reviewers` (old reviews are ignored by design)
- Ensure reviewers have permission to approve PRs in the repository

### Bot doesn't respond to `/merge` command

- Verify the command is in an issue comment (not a review comment)
- Check that the commenter is the PR author
- Look at Vercel logs to see if the webhook was received
- Ensure "Issue comment" event is enabled in GitHub App settings
