/**
 * Session management types and utilities
 */

import { ChildProcess } from 'child_process';
import { BoundaryTarget, Session } from '../types';
import { logger } from '../utils/logger';

/**
 * Create a new session from a connection
 */
export function createSession(
  target: BoundaryTarget,
  process: ChildProcess,
  localPort: number
): Session {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    targetId: target.id,
    targetName: target.name,
    targetType: target.type,
    localHost: '127.0.0.1',
    localPort,
    status: 'active',
    startTime: new Date(),
    process,
  };
}

/**
 * Check if a session is still active
 */
export function isSessionActive(session: Session): boolean {
  return session.status === 'active' && !session.process.killed;
}

/**
 * Get session duration in seconds
 */
export function getSessionDuration(session: Session): number {
  return Math.floor((Date.now() - session.startTime.getTime()) / 1000);
}

/**
 * Format session duration for display
 */
export function formatSessionDuration(session: Session): string {
  const seconds = getSessionDuration(session);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Get a display label for a session
 */
export function getSessionLabel(session: Session): string {
  return `${session.targetName} (${session.targetType.toUpperCase()})`;
}

/**
 * Get a detailed description for a session
 */
export function getSessionDescription(session: Session): string {
  const duration = formatSessionDuration(session);
  return `Port ${session.localPort} - ${duration}`;
}

/**
 * Terminate a session gracefully
 */
export async function terminateSession(session: Session): Promise<void> {
  logger.info(`Terminating session ${session.id} for target ${session.targetName}`);

  session.status = 'disconnecting';

  return new Promise((resolve) => {
    const process = session.process;

    // Set up exit handler
    const onExit = () => {
      session.status = 'terminated';
      resolve();
    };

    if (process.killed) {
      session.status = 'terminated';
      resolve();
      return;
    }

    process.once('exit', onExit);

    // Send SIGTERM
    process.kill('SIGTERM');

    // Force kill after timeout
    const forceKillTimeout = setTimeout(() => {
      if (!process.killed) {
        logger.warn(`Force killing session ${session.id}`);
        process.kill('SIGKILL');
      }
    }, 5000);

    // Clean up timeout on exit
    process.once('exit', () => {
      clearTimeout(forceKillTimeout);
    });
  });
}
