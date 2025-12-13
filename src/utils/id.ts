/**
 * ID generation utilities
 *
 * Centralizes ID generation to ensure consistency across the codebase.
 */

/**
 * Generate a unique session ID
 *
 * Format: session-{timestamp}-{random}
 * Example: session-1702406400000-k8f3m2
 */
export function generateSessionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `session-${timestamp}-${random}`;
}

/**
 * Generate a unique connection ID
 *
 * Format: conn-{timestamp}-{random}
 */
export function generateConnectionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `conn-${timestamp}-${random}`;
}
