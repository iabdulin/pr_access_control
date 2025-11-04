import { JUMP_APPROVERS, ANZA_APPROVERS } from './config.js';
import { checkApprovalStatus, buildStatusMessage } from './approval.js';

/**
 * Handles 'pull_request' (opened) events.
 * Posts a welcome comment with approval requirements.
 */
export async function handlePullRequestOpened(payload, api) {
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
export async function handlePullRequestReview(payload, api) {
  const review = payload.review;
  console.log(`[review] @${review.user.login} ${review.state} on PR#${payload.pull_request.number}`);

  const pr = await api.getPR(payload.pull_request.url);
  const status = await checkApprovalStatus(pr, api);
  const statusMsg = buildStatusMessage(status);

  if (review.state === 'changes_requested') {
    // 1. Handle "Request Changes"
    await api.postComment(
      pr.comments_url,
      `⛔ Merge blocked. @${review.user.login} has requested changes.\n\n${statusMsg}`
    );
  } else if (review.state === 'approved') {
    // 2. Handle "Approved"
    if (status.jumpOk && status.anzaOk) {
      await api.postComment(
        pr.comments_url,
        `✅ All approvals received! @${pr.user.login}, you can now merge this by commenting \`/merge\`.\n\n${statusMsg}`
      );
    } else {
      await api.postComment(
        pr.comments_url,
        `Thanks, @${review.user.login}!\n\n${statusMsg}`
      );
    }
  }
  // No action needed for 'commented' state
}

/**
 * Handles 'issue_comment' (created) events.
 * Listens for /merge commands.
 */
export async function handleIssueComment(payload, api) {
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
