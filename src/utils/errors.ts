/**
 * Error types and error handling utilities for Boundary extension
 */

export enum BoundaryErrorCode {
  CLI_NOT_FOUND = 'CLI_NOT_FOUND',
  CLI_EXECUTION_FAILED = 'CLI_EXECUTION_FAILED',
  AUTH_FAILED = 'AUTH_FAILED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TARGET_NOT_FOUND = 'TARGET_NOT_FOUND',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  PORT_CAPTURE_FAILED = 'PORT_CAPTURE_FAILED',
  REMOTE_SSH_NOT_INSTALLED = 'REMOTE_SSH_NOT_INSTALLED',
  REMOTE_SSH_FAILED = 'REMOTE_SSH_FAILED',
  PROCESS_TERMINATED = 'PROCESS_TERMINATED',
  PARSE_ERROR = 'PARSE_ERROR',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN = 'UNKNOWN',
}

export class BoundaryError extends Error {
  constructor(
    message: string,
    public readonly code: BoundaryErrorCode,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'BoundaryError';
    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BoundaryError);
    }
  }

  /**
   * Get user-friendly error message with guidance
   */
  getUserMessage(): string {
    switch (this.code) {
      case BoundaryErrorCode.CLI_NOT_FOUND:
        return 'Boundary CLI not found. Please install it from https://developer.hashicorp.com/boundary/downloads';
      case BoundaryErrorCode.CLI_EXECUTION_FAILED:
        return `Boundary CLI command failed: ${this.message}`;
      case BoundaryErrorCode.AUTH_FAILED:
        return `Authentication failed: ${this.message}. Please check your credentials.`;
      case BoundaryErrorCode.TOKEN_EXPIRED:
        return 'Your session has expired. Please log in again.';
      case BoundaryErrorCode.TARGET_NOT_FOUND:
        return `Target not found: ${this.message}`;
      case BoundaryErrorCode.CONNECTION_FAILED:
        return `Connection failed: ${this.message}. Please check your network and try again.`;
      case BoundaryErrorCode.PORT_CAPTURE_FAILED:
        return 'Failed to establish local proxy. Please try again.';
      case BoundaryErrorCode.REMOTE_SSH_NOT_INSTALLED:
        return 'Remote SSH extension not installed. Please install it to connect to targets.';
      case BoundaryErrorCode.REMOTE_SSH_FAILED:
        return `Failed to open Remote SSH connection: ${this.message}`;
      case BoundaryErrorCode.PROCESS_TERMINATED:
        return 'Connection process terminated unexpectedly.';
      case BoundaryErrorCode.PARSE_ERROR:
        return `Failed to parse response: ${this.message}`;
      case BoundaryErrorCode.TIMEOUT:
        return `Operation timed out: ${this.message}`;
      default:
        return this.message || 'An unexpected error occurred.';
    }
  }

  /**
   * Check if error is recoverable (user can retry)
   */
  isRecoverable(): boolean {
    switch (this.code) {
      case BoundaryErrorCode.CLI_NOT_FOUND:
      case BoundaryErrorCode.REMOTE_SSH_NOT_INSTALLED:
        return false; // Requires installation
      case BoundaryErrorCode.AUTH_FAILED:
      case BoundaryErrorCode.TOKEN_EXPIRED:
      case BoundaryErrorCode.CONNECTION_FAILED:
      case BoundaryErrorCode.PORT_CAPTURE_FAILED:
      case BoundaryErrorCode.TIMEOUT:
        return true; // Can retry
      default:
        return true;
    }
  }

  /**
   * Get suggested action for error
   */
  getSuggestedAction(): string | undefined {
    switch (this.code) {
      case BoundaryErrorCode.CLI_NOT_FOUND:
        return 'Install Boundary CLI';
      case BoundaryErrorCode.AUTH_FAILED:
      case BoundaryErrorCode.TOKEN_EXPIRED:
        return 'Login';
      case BoundaryErrorCode.REMOTE_SSH_NOT_INSTALLED:
        return 'Install Remote SSH';
      case BoundaryErrorCode.CONNECTION_FAILED:
      case BoundaryErrorCode.PORT_CAPTURE_FAILED:
        return 'Retry';
      default:
        return undefined;
    }
  }
}

/**
 * Wrap an error as a BoundaryError
 */
export function wrapError(error: unknown, code: BoundaryErrorCode = BoundaryErrorCode.UNKNOWN): BoundaryError {
  if (error instanceof BoundaryError) {
    return error;
  }

  if (error instanceof Error) {
    return new BoundaryError(error.message, code, error);
  }

  return new BoundaryError(String(error), code);
}

/**
 * Check if error is a specific BoundaryError code
 */
export function isErrorCode(error: unknown, code: BoundaryErrorCode): boolean {
  return error instanceof BoundaryError && error.code === code;
}

/**
 * Check if error indicates authentication is required
 */
export function isAuthRequired(error: unknown): boolean {
  if (isErrorCode(error, BoundaryErrorCode.AUTH_FAILED) ||
      isErrorCode(error, BoundaryErrorCode.TOKEN_EXPIRED)) {
    return true;
  }

  // Also check for 401/403 status codes in the error message
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('401') ||
        message.includes('403') ||
        message.includes('unauthenticated') ||
        message.includes('unauthorized') ||
        message.includes('forbidden') ||
        message.includes('permission denied') ||
        message.includes('permissiondenied')) {
      return true;
    }
  }

  return false;
}
