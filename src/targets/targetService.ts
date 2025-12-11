/**
 * Target Service for fetching and caching targets
 */

import * as vscode from 'vscode';
import { BoundaryScope, BoundaryTarget } from '../types';
import { getBoundaryCLI } from '../boundary/cli';
import { logger } from '../utils/logger';

export class TargetService implements vscode.Disposable {
  private targetsCache: Map<string, BoundaryTarget[]> = new Map();
  private scopesCache: BoundaryScope[] = [];
  private lastFetchTime: number = 0;
  private cacheTTL = 30000; // 30 seconds

  private readonly _onTargetsChanged = new vscode.EventEmitter<void>();
  readonly onTargetsChanged = this._onTargetsChanged.event;

  constructor() {}

  /**
   * Get all scopes
   */
  async getScopes(forceRefresh = false): Promise<BoundaryScope[]> {
    if (!forceRefresh && this.scopesCache.length > 0 && !this.isCacheExpired()) {
      return this.scopesCache;
    }

    try {
      const cli = getBoundaryCLI();

      // Get global scopes (orgs)
      const orgs = await cli.listScopes('global');

      // For each org, get projects
      const allScopes: BoundaryScope[] = [];
      for (const org of orgs) {
        allScopes.push(org);

        try {
          const projects = await cli.listScopes(org.id);
          allScopes.push(...projects);
        } catch (error) {
          logger.warn(`Failed to fetch projects for org ${org.id}:`, error);
        }
      }

      this.scopesCache = allScopes;
      this.lastFetchTime = Date.now();
      return allScopes;
    } catch (error) {
      logger.error('Failed to fetch scopes:', error);
      throw error;
    }
  }

  /**
   * Get all targets (from all accessible scopes)
   */
  async getAllTargets(forceRefresh = false): Promise<BoundaryTarget[]> {
    if (!forceRefresh && !this.isCacheExpired()) {
      const allTargets: BoundaryTarget[] = [];
      for (const targets of this.targetsCache.values()) {
        allTargets.push(...targets);
      }
      if (allTargets.length > 0) {
        return allTargets;
      }
    }

    try {
      const cli = getBoundaryCLI();

      // List all targets recursively from global scope
      const targets = await cli.listTargets(undefined, true);

      // Filter to only targets user can connect to
      const connectableTargets = targets.filter(t =>
        t.authorizedActions.includes('authorize-session')
      );

      // Update cache
      this.targetsCache.clear();
      for (const target of connectableTargets) {
        const scopeTargets = this.targetsCache.get(target.scopeId) || [];
        scopeTargets.push(target);
        this.targetsCache.set(target.scopeId, scopeTargets);
      }

      this.lastFetchTime = Date.now();
      this._onTargetsChanged.fire();

      return connectableTargets;
    } catch (error) {
      logger.error('Failed to fetch targets:', error);
      throw error;
    }
  }

  /**
   * Get targets for a specific scope
   */
  async getTargetsForScope(scopeId: string, forceRefresh = false): Promise<BoundaryTarget[]> {
    if (!forceRefresh && !this.isCacheExpired()) {
      const cached = this.targetsCache.get(scopeId);
      if (cached) {
        return cached;
      }
    }

    try {
      const cli = getBoundaryCLI();
      const targets = await cli.listTargets(scopeId, false);

      // Filter to only targets user can connect to
      const connectableTargets = targets.filter(t =>
        t.authorizedActions.includes('authorize-session')
      );

      this.targetsCache.set(scopeId, connectableTargets);
      this.lastFetchTime = Date.now();

      return connectableTargets;
    } catch (error) {
      logger.error(`Failed to fetch targets for scope ${scopeId}:`, error);
      throw error;
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
        return found;
      }
    }

    // Fetch all and try again
    const allTargets = await this.getAllTargets(true);
    return allTargets.find(t => t.id === targetId);
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
   * Group targets by scope
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
