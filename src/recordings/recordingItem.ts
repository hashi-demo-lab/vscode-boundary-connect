/**
 * Recording TreeItem implementations
 */

import * as vscode from 'vscode';
import { SessionRecording, RecordingTreeItemData, RecordingTreeItemType } from '../types';

export class RecordingTreeItem extends vscode.TreeItem {
  constructor(
    public readonly data: RecordingTreeItemData
  ) {
    super(data.label, RecordingTreeItem.getCollapsibleState(data.type));

    this.id = data.id;
    this.description = data.description;
    this.tooltip = data.tooltip || data.label;
    this.contextValue = data.type;

    // Enable decorations for recordings via custom URI scheme
    if (data.type === 'recording' && data.recording) {
      this.resourceUri = vscode.Uri.parse(`boundary-recording:${data.recording.id}`);
    }

    this.setIcon(data.type);
    this.setCommand(data);
  }

  private static getCollapsibleState(type: RecordingTreeItemType): vscode.TreeItemCollapsibleState {
    switch (type) {
      case 'target-group':
        return vscode.TreeItemCollapsibleState.Collapsed;
      case 'recording':
      case 'loading':
      case 'error':
        return vscode.TreeItemCollapsibleState.None;
      default:
        return vscode.TreeItemCollapsibleState.None;
    }
  }

  private setIcon(type: RecordingTreeItemType): void {
    switch (type) {
      case 'target-group':
        this.iconPath = new vscode.ThemeIcon('folder');
        break;
      case 'recording':
        this.iconPath = new vscode.ThemeIcon('record');
        break;
      case 'loading':
        this.iconPath = new vscode.ThemeIcon('loading~spin');
        break;
      case 'error':
        this.iconPath = new vscode.ThemeIcon('error');
        break;
    }
  }

  private setCommand(data: RecordingTreeItemData): void {
    switch (data.type) {
      // Recordings use right-click context menu only (no single-click action)
      case 'error':
        this.command = {
          command: 'boundary.refreshRecordings',
          title: 'Refresh',
        };
        break;
    }
  }
}

/**
 * Create a TreeItem for a target group (groups recordings by target)
 */
export function createTargetGroupItem(
  targetId: string,
  targetName: string | undefined,
  recordingCount: number
): RecordingTreeItemData {
  const label = targetName || targetId;
  const description = `${recordingCount} recording${recordingCount !== 1 ? 's' : ''}`;

  return {
    type: 'target-group',
    id: `group-${targetId}`,
    label,
    description,
    tooltip: `${label} - ${description}`,
    targetId,
    targetName,
  };
}

/**
 * Create a TreeItem for a recording
 */
export function createRecordingItem(recording: SessionRecording): RecordingTreeItemData {
  // Format the created time for display
  const createdDate = new Date(recording.createdTime);
  const dateLabel = createdDate.toLocaleString();

  // Use duration if available, otherwise show state
  const description = recording.duration
    ? `(${recording.duration})`
    : recording.state
      ? `[${recording.state}]`
      : '';

  return {
    type: 'recording',
    id: recording.id,
    label: dateLabel,
    description,
    tooltip: createRecordingTooltip(recording),
    recording,
  };
}

function createRecordingTooltip(recording: SessionRecording): string {
  const lines = [
    `Recording: ${recording.id}`,
    `Created: ${new Date(recording.createdTime).toLocaleString()}`,
  ];

  if (recording.duration) {
    lines.push(`Duration: ${recording.duration}`);
  }

  if (recording.state) {
    lines.push(`State: ${recording.state}`);
  }

  if (recording.byteCount) {
    const sizeMB = (recording.byteCount / (1024 * 1024)).toFixed(2);
    lines.push(`Size: ${sizeMB} MB`);
  }

  if (recording.mimeType) {
    lines.push(`Type: ${recording.mimeType}`);
  }

  if (recording.targetId) {
    lines.push(`Target: ${recording.targetName || recording.targetId}`);
  }

  if (recording.sessionId) {
    lines.push(`Session: ${recording.sessionId}`);
  }

  return lines.join('\n');
}

/**
 * Create a loading item
 */
export function createLoadingItem(): RecordingTreeItemData {
  return {
    type: 'loading',
    id: 'loading',
    label: 'Loading recordings...',
  };
}

/**
 * Create an error item (clickable to refresh)
 */
export function createErrorItem(message: string): RecordingTreeItemData {
  return {
    type: 'error',
    id: 'error',
    label: message,
    description: 'Click to refresh',
    tooltip: 'Click to retry loading recordings',
  };
}
