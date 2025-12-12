/**
 * Retry utilities with exponential backoff
 *
 * Provides resilient execution of async operations with configurable
 * retry behavior for transient failures.
 */

import { logger } from './logger';
import { BoundaryError, BoundaryErrorCode, isAuthRequired } from './errors';

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Initial backoff delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum backoff delay in milliseconds (default: 10000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Custom function to determine if error is retryable */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Operation name for logging */
  operationName?: string;
}

/**
 * Default retry predicate - determines if an error is retryable
 *
 * NOT retryable:
 * - Authentication errors (requires user action)
 * - CLI not found (requires installation)
 * - Remote SSH not installed (requires installation)
 *
 * Retryable:
 * - Connection failures
 * - Timeouts
 * - CLI execution failures (transient)
 */
export function isRetryableError(error: unknown): boolean {
  // Auth errors require user action, not retries
  if (isAuthRequired(error)) {
    return false;
  }

  if (error instanceof BoundaryError) {
    switch (error.code) {
      // Not retryable - requires installation or user action
      case BoundaryErrorCode.CLI_NOT_FOUND:
      case BoundaryErrorCode.REMOTE_SSH_NOT_INSTALLED:
      case BoundaryErrorCode.AUTH_FAILED:
      case BoundaryErrorCode.TOKEN_EXPIRED:
      case BoundaryErrorCode.TARGET_NOT_FOUND:
        return false;

      // Retryable - transient failures
      case BoundaryErrorCode.CONNECTION_FAILED:
      case BoundaryErrorCode.TIMEOUT:
      case BoundaryErrorCode.CLI_EXECUTION_FAILED:
      case BoundaryErrorCode.PORT_CAPTURE_FAILED:
      case BoundaryErrorCode.PARSE_ERROR:
        return true;

      default:
        return true;
    }
  }

  // Generic errors are potentially retryable
  return true;
}

/**
 * Calculate exponential backoff delay
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  multiplier: number
): number {
  // Exponential backoff: initialDelay * multiplier^(attempt-1)
  const delay = initialDelayMs * Math.pow(multiplier, attempt - 1);
  // Add jitter (±10%) to prevent thundering herd
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, maxDelayMs);
}

/**
 * Execute an async operation with retry and exponential backoff
 *
 * @example
 * ```typescript
 * const targets = await withRetry(
 *   () => cli.listTargets(),
 *   { operationName: 'listTargets', maxAttempts: 3 }
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    shouldRetry = isRetryableError,
    operationName = 'operation',
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        logger.warn(
          `${operationName} failed after ${attempt} attempt(s), not retrying:`,
          lastError.message
        );
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = calculateDelay(attempt, initialDelayMs, maxDelayMs, backoffMultiplier);

      logger.info(
        `${operationName} failed (attempt ${attempt}/${maxAttempts}), ` +
        `retrying in ${Math.round(delay)}ms: ${lastError.message}`
      );

      // Wait before retry
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a retry wrapper with preset options
 *
 * @example
 * ```typescript
 * const retryWithDefaults = createRetryWrapper({ maxAttempts: 5 });
 * const result = await retryWithDefaults(() => fetchData());
 * ```
 */
export function createRetryWrapper(
  defaultOptions: RetryOptions
): <T>(operation: () => Promise<T>, options?: RetryOptions) => Promise<T> {
  return <T>(operation: () => Promise<T>, options?: RetryOptions) =>
    withRetry(operation, { ...defaultOptions, ...options });
}
