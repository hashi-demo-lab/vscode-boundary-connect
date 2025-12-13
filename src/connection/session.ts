/**
 * Session management types and utilities
 */

import { ChildProcess } from 'child_process';
import { BoundaryTarget, Session } from '../types';
import { logger } from '../utils/logger';
import { generateSessionId } from '../utils/id';

/**
 * Create a new session from a connection
 */
export function createSession(
  target: BoundaryTarget,
  process: ChildProcess,
  localPort: number
): Session {
  return {
    id: generateSessionId(),
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

/** Default timeout for graceful termination before force kill */
const FORCE_KILL_TIMEOUT_MS = 5000;

/**
 * Terminate a session gracefully with proper cleanup
 *
 * Uses a cleaner pattern that ensures timeout cleanup regardless
 * of how the process exits.
 */
export async function terminateSession(session: Session): Promise<void> {
  logger.info(`Terminating session ${session.id} for target ${session.targetName}`);

  session.status = 'disconnecting';
  const proc = session.process;

  // Already terminated
  if (proc.killed) {
    session.status = 'terminated';
    return;
  }

  return new Promise((resolve) => {
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;
    let resolved = false;

    const cleanup = () => {
      if (resolved) {
        return;
      }
      resolved = true;

      // Clear the force kill timeout
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
        forceKillTimeout = undefined;
      }

      session.status = 'terminated';
      resolve();
    };

    // Listen for process exit
    proc.once('exit', cleanup);

    // Send SIGTERM for graceful shutdown
    proc.kill('SIGTERM');

    // Schedule force kill if process doesn't exit gracefully
    forceKillTimeout = setTimeout(() => {
      if (!proc.killed && !resolved) {
        logger.warn(`Force killing session ${session.id} after ${FORCE_KILL_TIMEOUT_MS}ms timeout`);
        proc.kill('SIGKILL');
      }
    }, FORCE_KILL_TIMEOUT_MS);

    // Ensure timeout doesn't keep Node process alive
    forceKillTimeout.unref?.();
  });
}
