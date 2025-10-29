import { request } from 'https';
import { generateJwt } from './utils.js';

/**
 * A lightweight client for making authenticated GitHub API calls.
 */
export class GitHubAPI {
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
