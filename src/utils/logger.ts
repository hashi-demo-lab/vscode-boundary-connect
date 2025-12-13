/**
 * Logging utilities for Boundary extension
 */

import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Sensitive field names that should be redacted in logs
 */
const SENSITIVE_FIELD_PATTERNS = [
  /^password$/i,
  /password$/i,  // matches oldPassword, newPassword, etc.
  /^privateKey$/i,
  /^privateKeyPassphrase$/i,
  /^token$/i,
  /token$/i,  // matches authorizationToken, accessToken, etc.
  /^secret$/i,
  /^apiKey$/i,
];

/**
 * Check if a field name is sensitive and should be redacted
 */
function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(fieldName));
}

/**
 * Sanitize an object for logging by redacting sensitive fields
 */
function sanitizeForLogging(data: unknown, seen = new WeakSet<object>()): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  // Handle circular references - data is guaranteed to be non-null object here
  // TypeScript narrows 'data' to 'object' after the typeof check
  if (seen.has(data)) {
    return '[Circular]';
  }
  seen.add(data);

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => sanitizeForLogging(item, seen));
  }

  // Handle objects
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveField(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLogging(value, seen);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export class Logger {
  private static instance: Logger | undefined;
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel = 'info';

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Boundary');
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.logLevel];
  }

  private formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    let formattedMessage = `[${timestamp}] [${levelStr}] ${message}`;

    if (args.length > 0) {
      formattedMessage += ' ' + args.map(arg => {
        if (arg instanceof Error) {
          return `${arg.message}\n${arg.stack || ''}`;
        }
        if (typeof arg === 'object') {
          try {
            // Sanitize objects to redact sensitive fields before logging
            const sanitized = sanitizeForLogging(arg);
            return JSON.stringify(sanitized, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');
    }

    return formattedMessage;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      this.outputChannel.appendLine(this.formatMessage('debug', message, ...args));
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      this.outputChannel.appendLine(this.formatMessage('info', message, ...args));
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      this.outputChannel.appendLine(this.formatMessage('warn', message, ...args));
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      this.outputChannel.appendLine(this.formatMessage('error', message, ...args));
    }
  }

  show(): void {
    this.outputChannel.show();
  }

  dispose(): void {
    this.outputChannel.dispose();
    Logger.instance = undefined;
  }
}

// Convenience functions for quick access
export const logger = {
  debug: (message: string, ...args: unknown[]) => Logger.getInstance().debug(message, ...args),
  info: (message: string, ...args: unknown[]) => Logger.getInstance().info(message, ...args),
  warn: (message: string, ...args: unknown[]) => Logger.getInstance().warn(message, ...args),
  error: (message: string, ...args: unknown[]) => Logger.getInstance().error(message, ...args),
  show: () => Logger.getInstance().show(),
  setLogLevel: (level: LogLevel) => Logger.getInstance().setLogLevel(level),
};
