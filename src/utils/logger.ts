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
            return JSON.stringify(arg, null, 2);
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
