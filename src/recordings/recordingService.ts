/**
 * Recording Service for fetching and caching session recordings
 *
 * Design principles:
 * 1. Thread-safe cache access with mutex
 * 2. Returns copies of cached data to prevent mutation
 * 3. Clear separation between fetch and cache operations
 */

import * as vscode from 'vscode';
import { SessionRecording, IBoundaryCLI, IRecordingService } from '../types';
import { getBoundaryCLI } from '../boundary/cli';
import { logger } from '../utils/logger';

/**
 * Simple mutex for preventing concurrent operations
 */
class Mutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    return new Promise(resolve => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => this.release());
        } else {
          this.waitQueue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  private release(): void {
    this.locked = false;
    const next = this.waitQueue.shift();
    if (next) {
      next();
    }
  }
}

export class RecordingService implements IRecordingService {
  private recordingsCache: Map<string, SessionRecording[]> = new Map();
  private lastFetchTime: number = 0;
  private cacheTTL = 30000; // 30 seconds

  // Mutex for cache operations
  private readonly fetchMutex = new Mutex();

  // In-flight fetch promise to prevent duplicate requests
  private fetchInProgress: Promise<SessionRecording[]> | undefined;

  private readonly _onRecordingsChanged = new vscode.EventEmitter<void>();
  readonly onRecordingsChanged = this._onRecordingsChanged.event;

  private readonly cli: IBoundaryCLI;

  /**
   * Create a new RecordingService
   * @param cli - Boundary CLI (optional for backward compatibility)
   */
  constructor(cli?: IBoundaryCLI) {
    this.cli = cli ?? getBoundaryCLI();
  }

  /**
   * Get recordings for a specific scope
   * Uses mutex and deduplication to prevent race conditions
   */
  async getRecordings(scopeId: string, forceRefresh = false): Promise<SessionRecording[]> {
    // Quick path: return cached data if valid
    if (!forceRefresh && !this.isCacheExpired()) {
      const cached = this.recordingsCache.get(scopeId);
      if (cached) {
        return [...cached]; // Return copy
      }
    }

    // If a fetch is already in progress, wait for it
    if (this.fetchInProgress) {
      logger.debug('Fetch already in progress, waiting...');
      return this.fetchInProgress;
    }

    // Start new fetch with mutex protection
    this.fetchInProgress = this.doFetchRecordings(scopeId);

    try {
      return await this.fetchInProgress;
    } finally {
      this.fetchInProgress = undefined;
    }
  }

  /**
   * Internal fetch implementation (protected by mutex)
   */
  private async doFetchRecordings(scopeId: string): Promise<SessionRecording[]> {
    const release = await this.fetchMutex.acquire();
    try {
      // Double-check cache after acquiring lock
      if (!this.isCacheExpired()) {
        const cached = this.recordingsCache.get(scopeId);
        if (cached) {
          return [...cached];
        }
      }

      logger.debug(`Fetching recordings from scope ${scopeId}...`);

      // List recordings from the scope
      const recordings = await this.cli.listSessionRecordings(scopeId);

      // Update cache
      this.recordingsCache.set(scopeId, recordings);
      this.lastFetchTime = Date.now();
      this._onRecordingsChanged.fire();

      logger.debug(`Fetched ${recordings.length} recordings`);
      return [...recordings]; // Return copy
    } catch (error) {
      logger.error(`Failed to fetch recordings for scope ${scopeId}:`, error);
      throw error;
    } finally {
      release();
    }
  }

  /**
   * Get a specific recording by ID
   */
  async getRecordingById(id: string): Promise<SessionRecording | undefined> {
    // Check cache first
    for (const recordings of this.recordingsCache.values()) {
      const found = recordings.find(r => r.id === id);
      if (found) {
        return { ...found }; // Return copy
      }
    }

    // Not found in cache
    return undefined;
  }

  /**
   * Group recordings by target (operates on provided data, not cache)
   */
  groupRecordingsByTarget(recordings: SessionRecording[]): Map<string, SessionRecording[]> {
    const grouped = new Map<string, SessionRecording[]>();

    for (const recording of recordings) {
      // Use target ID as key (or "unknown" if not set)
      const key = recording.targetId || 'unknown';
      const group = grouped.get(key) || [];
      group.push(recording);
      grouped.set(key, group);
    }

    return grouped;
  }

  /**
   * Refresh the cache
   */
  async refresh(): Promise<void> {
    this.clearCache();
    // Note: Recordings are scope-specific, so we don't auto-fetch here
    // The provider will call getRecordings() with the appropriate scope
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.recordingsCache.clear();
    this.lastFetchTime = 0;
    this._onRecordingsChanged.fire();
  }

  private isCacheExpired(): boolean {
    return Date.now() - this.lastFetchTime > this.cacheTTL;
  }

  dispose(): void {
    this._onRecordingsChanged.dispose();
  }
}

// Singleton instance
let recordingServiceInstance: RecordingService | undefined;

export function getRecordingService(): RecordingService {
  if (!recordingServiceInstance) {
    recordingServiceInstance = new RecordingService();
  }
  return recordingServiceInstance;
}

export function disposeRecordingService(): void {
  if (recordingServiceInstance) {
    recordingServiceInstance.dispose();
    recordingServiceInstance = undefined;
  }
}
