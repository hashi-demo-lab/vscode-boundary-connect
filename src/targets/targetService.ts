/**
 * Target Service for fetching and caching targets
 *
 * Design principles:
 * 1. Thread-safe cache access with mutex
 * 2. Returns copies of cached data to prevent mutation
 * 3. Clear separation between fetch and cache operations
 */

import * as vscode from 'vscode';
import { BoundaryScope, BoundaryTarget, IBoundaryCLI, ITargetService } from '../types';
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

export class TargetService implements ITargetService {
  private targetsCache: Map<string, BoundaryTarget[]> = new Map();
  private scopesCache: BoundaryScope[] = [];
  private lastFetchTime: number = 0;
  private cacheTTL = 30000; // 30 seconds

  // Mutex for cache operations
  private readonly fetchMutex = new Mutex();

  // In-flight fetch promise to prevent duplicate requests
  private fetchInProgress: Promise<BoundaryTarget[]> | undefined;

  private readonly _onTargetsChanged = new vscode.EventEmitter<void>();
  readonly onTargetsChanged = this._onTargetsChanged.event;

  private readonly cli: IBoundaryCLI;

  /**
   * Create a new TargetService
   * @param cli - Boundary CLI (optional for backward compatibility)
   */
  constructor(cli?: IBoundaryCLI) {
    this.cli = cli ?? getBoundaryCLI();
  }

  /**
   * Get all scopes
   */
  async getScopes(forceRefresh = false): Promise<BoundaryScope[]> {
    if (!forceRefresh && this.scopesCache.length > 0 && !this.isCacheExpired()) {
      return [...this.scopesCache]; // Return copy
    }

    const release = await this.fetchMutex.acquire();
    try {
      // Double-check after acquiring lock
      if (!forceRefresh && this.scopesCache.length > 0 && !this.isCacheExpired()) {
        return [...this.scopesCache];
      }

      // Get global scopes (orgs)
      const orgs = await this.cli.listScopes('global');

      // For each org, get projects
      const allScopes: BoundaryScope[] = [];
      for (const org of orgs) {
        allScopes.push(org);

        try {
          const projects = await this.cli.listScopes(org.id);
          allScopes.push(...projects);
        } catch (error) {
          logger.warn(`Failed to fetch projects for org ${org.id}:`, error);
        }
      }

      this.scopesCache = allScopes;
      this.lastFetchTime = Date.now();
      return [...allScopes]; // Return copy
    } catch (error) {
      logger.error('Failed to fetch scopes:', error);
      throw error;
    } finally {
      release();
    }
  }

  /**
   * Get all targets (from all accessible scopes)
   * Uses mutex and deduplication to prevent race conditions
   */
  async getAllTargets(forceRefresh = false): Promise<BoundaryTarget[]> {
    // Quick path: return cached data if valid
    if (!forceRefresh && !this.isCacheExpired()) {
      const cached = this.getCachedTargets();
      if (cached.length > 0) {
        return cached;
      }
    }

    // If a fetch is already in progress, wait for it
    if (this.fetchInProgress) {
      logger.debug('Fetch already in progress, waiting...');
      return this.fetchInProgress;
    }

    // Start new fetch with mutex protection
    this.fetchInProgress = this.doFetchAllTargets();

    try {
      return await this.fetchInProgress;
    } finally {
      this.fetchInProgress = undefined;
    }
  }

  /**
   * Internal fetch implementation (protected by mutex)
   */
  private async doFetchAllTargets(): Promise<BoundaryTarget[]> {
    const release = await this.fetchMutex.acquire();
    try {
      // Double-check cache after acquiring lock
      if (!this.isCacheExpired()) {
        const cached = this.getCachedTargets();
        if (cached.length > 0) {
          return cached;
        }
      }

      logger.debug('Fetching targets from Boundary...');

      // List all targets recursively from global scope
      const targets = await this.cli.listTargets();

      // Log which targets can be connected to
      const connectable = targets.filter(t => t.authorizedActions.includes('authorize-session'));
      const readOnly = targets.filter(t => !t.authorizedActions.includes('authorize-session'));

      if (readOnly.length > 0) {
        logger.info(`${readOnly.length} targets are read-only (missing authorize-session permission): ${readOnly.map(t => t.name).join(', ')}`);
      }
      logger.info(`${connectable.length} targets are connectable, ${targets.length} total`);

      // Update cache with ALL targets (UI will handle non-connectable)
      this.updateCache(targets);

      logger.debug(`Fetched ${targets.length} targets (${connectable.length} connectable)`);
      return [...targets]; // Return all targets
    } catch (error) {
      logger.error('Failed to fetch targets:', error);
      throw error;
    } finally {
      release();
    }
  }

  /**
   * Get cached targets (returns copy)
   */
  private getCachedTargets(): BoundaryTarget[] {
    const allTargets: BoundaryTarget[] = [];
    for (const targets of this.targetsCache.values()) {
      allTargets.push(...targets);
    }
    return allTargets;
  }

  /**
   * Update cache atomically
   */
  private updateCache(targets: BoundaryTarget[]): void {
    const newCache = new Map<string, BoundaryTarget[]>();

    for (const target of targets) {
      const scopeTargets = newCache.get(target.scopeId) || [];
      scopeTargets.push(target);
      newCache.set(target.scopeId, scopeTargets);
    }

    // Atomic swap
    this.targetsCache = newCache;
    this.lastFetchTime = Date.now();
    this._onTargetsChanged.fire();
  }

  /**
   * Get targets for a specific scope
   */
  async getTargetsForScope(scopeId: string, forceRefresh = false): Promise<BoundaryTarget[]> {
    if (!forceRefresh && !this.isCacheExpired()) {
      const cached = this.targetsCache.get(scopeId);
      if (cached) {
        return [...cached]; // Return copy
      }
    }

    const release = await this.fetchMutex.acquire();
    try {
      // Double-check after acquiring lock
      if (!forceRefresh && !this.isCacheExpired()) {
        const cached = this.targetsCache.get(scopeId);
        if (cached) {
          return [...cached];
        }
      }

      // Note: listTargets() now auto-discovers all accessible targets
      const targets = await this.cli.listTargets();

      this.targetsCache.set(scopeId, targets);
      this.lastFetchTime = Date.now();

      return [...targets]; // Return all targets
    } catch (error) {
      logger.error(`Failed to fetch targets for scope ${scopeId}:`, error);
      throw error;
    } finally {
      release();
    }
  }

  /**
   * Get a specific target by ID
   */
  async getTarget(targetId: string): Promise<BoundaryTarget | undefined> {
    // Check cache first
    for (const targets of this.targetsCache.values()) {
      const found = targets.find(t => t.id === targetId);
      if (found) {
        return { ...found }; // Return copy
      }
    }

    // Fetch all and try again
    const allTargets = await this.getAllTargets(true);
    const found = allTargets.find(t => t.id === targetId);
    return found ? { ...found } : undefined;
  }

  /**
   * Refresh the cache
   */
  async refresh(): Promise<void> {
    this.clearCache();
    await this.getAllTargets(true);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.targetsCache.clear();
    this.scopesCache = [];
    this.lastFetchTime = 0;
  }

  /**
   * Group targets by scope (operates on provided data, not cache)
   */
  groupTargetsByScope(targets: BoundaryTarget[]): Map<string, BoundaryTarget[]> {
    const grouped = new Map<string, BoundaryTarget[]>();

    for (const target of targets) {
      const key = target.scope.name || target.scopeId;
      const group = grouped.get(key) || [];
      group.push(target);
      grouped.set(key, group);
    }

    return grouped;
  }

  private isCacheExpired(): boolean {
    return Date.now() - this.lastFetchTime > this.cacheTTL;
  }

  dispose(): void {
    this._onTargetsChanged.dispose();
  }
}

// Singleton instance
let targetServiceInstance: TargetService | undefined;

export function getTargetService(): TargetService {
  if (!targetServiceInstance) {
    targetServiceInstance = new TargetService();
  }
  return targetServiceInstance;
}

export function disposeTargetService(): void {
  if (targetServiceInstance) {
    targetServiceInstance.dispose();
    targetServiceInstance = undefined;
  }
}
