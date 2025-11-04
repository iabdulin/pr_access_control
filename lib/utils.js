import { createHmac, timingSafeEqual, createSign } from 'crypto';
import { GITHUB_WEBHOOK_SECRET, GITHUB_PRIVATE_KEY, GITHUB_APP_ID } from './config.js';

/**
 * Verifies the webhook signature from GitHub.
 */
export function verifyWebhookSignature(signature, body) {
  if (!signature) {
    throw new Error('No signature provided');
  }
  if (!GITHUB_WEBHOOK_SECRET) {
    throw new Error('GITHUB_WEBHOOK_SECRET is not set');
  }

  const hmac = createHmac('sha256', GITHUB_WEBHOOK_SECRET);
  hmac.update(body);
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
export function generateJwt() {
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
