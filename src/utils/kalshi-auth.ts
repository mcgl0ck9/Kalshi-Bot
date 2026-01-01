/**
 * Kalshi API RSA Authentication
 *
 * Implements RSA-SHA256 signature authentication for Kalshi Trading API.
 * Based on Kalshi's authentication specification.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { KALSHI_API_KEY_ID, KALSHI_PRIVATE_KEY, KALSHI_PRIVATE_KEY_PATH } from '../config.js';
import { logger } from './logger.js';

// =============================================================================
// TYPES
// =============================================================================

interface KalshiAuthHeaders {
  'KALSHI-ACCESS-KEY': string;
  'KALSHI-ACCESS-SIGNATURE': string;
  'KALSHI-ACCESS-TIMESTAMP': string;
  'Content-Type': string;
  'Accept': string;
}

// =============================================================================
// KEY LOADING
// =============================================================================

let cachedPrivateKey: string | null = null;

/**
 * Load the private key from file or environment
 */
function loadPrivateKey(): string | null {
  if (cachedPrivateKey) return cachedPrivateKey;

  // Try inline key first
  if (KALSHI_PRIVATE_KEY) {
    // Handle escaped newlines
    cachedPrivateKey = KALSHI_PRIVATE_KEY.replace(/\\n/g, '\n');
    return cachedPrivateKey;
  }

  // Try file path
  if (KALSHI_PRIVATE_KEY_PATH) {
    try {
      const keyPath = path.isAbsolute(KALSHI_PRIVATE_KEY_PATH)
        ? KALSHI_PRIVATE_KEY_PATH
        : path.join(process.cwd(), KALSHI_PRIVATE_KEY_PATH);

      cachedPrivateKey = fs.readFileSync(keyPath, 'utf-8');
      return cachedPrivateKey;
    } catch (error) {
      logger.error(`Failed to load Kalshi private key from ${KALSHI_PRIVATE_KEY_PATH}: ${error}`);
      return null;
    }
  }

  return null;
}

// =============================================================================
// SIGNATURE GENERATION
// =============================================================================

/**
 * Generate RSA-SHA256 signature for Kalshi API request
 *
 * The message format is: timestamp + method + path
 * For example: "1704067200000GET/trade-api/v2/markets"
 */
function signRequest(timestamp: string, method: string, path: string): string | null {
  const privateKey = loadPrivateKey();
  if (!privateKey) {
    logger.debug('No Kalshi private key available for signing');
    return null;
  }

  try {
    // Message to sign: timestamp + method + path (no body for GET requests)
    const message = `${timestamp}${method}${path}`;

    // Create RSA-SHA256 signature
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    sign.end();

    const signature = sign.sign(privateKey, 'base64');
    return signature;
  } catch (error) {
    logger.error(`Failed to sign Kalshi request: ${error}`);
    return null;
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Check if Kalshi authentication is configured
 */
export function hasKalshiAuth(): boolean {
  return !!(KALSHI_API_KEY_ID && (KALSHI_PRIVATE_KEY || KALSHI_PRIVATE_KEY_PATH));
}

/**
 * Generate authentication headers for a Kalshi API request
 *
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - API path (e.g., "/trade-api/v2/markets")
 * @returns Headers object or null if auth is not configured
 */
export function getKalshiAuthHeaders(method: string, path: string): KalshiAuthHeaders | null {
  if (!KALSHI_API_KEY_ID) {
    return null;
  }

  // Timestamp in milliseconds
  const timestamp = Date.now().toString();

  // Generate signature
  const signature = signRequest(timestamp, method.toUpperCase(), path);
  if (!signature) {
    return null;
  }

  return {
    'KALSHI-ACCESS-KEY': KALSHI_API_KEY_ID,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

/**
 * Make an authenticated request to Kalshi API
 *
 * @param endpoint - Full URL or path (e.g., "/trade-api/v2/markets")
 * @param options - Fetch options (method, body, etc.)
 * @returns Response or null on auth failure
 */
export async function kalshiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response | null> {
  const method = (options.method ?? 'GET').toUpperCase();

  // Parse the path from the URL
  let path: string;
  let fullUrl: string;

  // Use api.elections.kalshi.com for authenticated requests
  const baseUrl = 'https://api.elections.kalshi.com';

  if (endpoint.startsWith('http')) {
    const url = new URL(endpoint);
    path = url.pathname + url.search;
    // Replace any kalshi domain with elections endpoint for auth
    fullUrl = `${baseUrl}${path}`;
  } else {
    path = endpoint;
    fullUrl = `${baseUrl}${endpoint}`;
  }

  // Get auth headers
  const authHeaders = getKalshiAuthHeaders(method, path);

  if (!authHeaders) {
    // Fall back to unauthenticated request (still use elections API)
    logger.debug(`Making unauthenticated request to ${fullUrl}`);
    return fetch(fullUrl, {
      ...options,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  }

  logger.debug(`Making authenticated request to ${path}`);

  // Make authenticated request
  return fetch(fullUrl, {
    ...options,
    method,
    headers: {
      ...authHeaders,
      ...options.headers,
    },
  });
}

/**
 * Fetch JSON from Kalshi API with authentication
 */
export async function kalshiFetchJson<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T | null> {
  try {
    const response = await kalshiFetch(endpoint, options);

    if (!response) {
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      logger.debug(`Kalshi API error: ${response.status} ${response.statusText} - ${errorText.substring(0, 200)}`);
      return null;
    }

    return await response.json() as T;
  } catch (error) {
    logger.debug(`Kalshi fetch error: ${error}`);
    return null;
  }
}
