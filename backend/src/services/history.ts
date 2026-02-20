import fs from 'fs/promises';
import path from 'path';
import { ComparisonResult, ComparisonHistory } from '../../../shared/types';
import { APP_PATHS, settingsService } from './settings';

// Use centralized app data paths
const HISTORY_DIR = APP_PATHS.history;

export class HistoryService {
  private getMaxHistory(): number {
    const settings = settingsService.getSettings();
    return settings.maxHistoryItems || 20;
  }
  async init(): Promise<void> {
    await fs.mkdir(HISTORY_DIR, { recursive: true });
  }

  /**
   * Find existing history entry with same image combination AND same digest (same version)
   * Only returns an entry if the images AND digests match (same version of image)
   * Returns null if image has been updated (new digest/cache folder)
   */
  private async findExistingEntry(comparison: ComparisonResult): Promise<string | null> {
    const files = await fs.readdir(HISTORY_DIR);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const filePath = path.join(HISTORY_DIR, file);
        const data = await fs.readFile(filePath, 'utf-8');
        const existing: ComparisonResult = JSON.parse(data);
        
        // Check if same image combination (same left/right in same order)
        const sameImages = 
          existing.leftImage.fullName === comparison.leftImage.fullName &&
          existing.rightImage.fullName === comparison.rightImage.fullName &&
          existing.isSingleImageMode === comparison.isSingleImageMode;
        
        if (sameImages) {
          // Also check if the digests match - if they differ, this is a new version
          // and we should create a new history entry to preserve the link to original cache
          const sameVersion = 
            existing.leftImage.digest === comparison.leftImage.digest &&
            existing.rightImage.digest === comparison.rightImage.digest;
          
          if (sameVersion) {
            return existing.id;
          }
          // Different digest = new version, don't return existing ID
          // This will cause a new history entry to be created, preserving the old one
        }
      } catch {
        // Skip invalid files
      }
    }
    
    return null;
  }

  async save(comparison: ComparisonResult): Promise<void> {
    // Check for existing entry with same image combination
    const existingId = await this.findExistingEntry(comparison);
    
    if (existingId) {
      // Delete the old entry file
      const oldFilePath = path.join(HISTORY_DIR, `${existingId}.json`);
      try {
        await fs.unlink(oldFilePath);
      } catch {
        // File might not exist, continue
      }
    }
    
    // Save with new timestamp (using the new comparison's ID and timestamp)
    const filePath = path.join(HISTORY_DIR, `${comparison.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(comparison, null, 2));
    
    // Cleanup old history
    await this.cleanup();
  }

  async getAll(): Promise<ComparisonHistory[]> {
    const files = await fs.readdir(HISTORY_DIR);
    const history: ComparisonHistory[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const filePath = path.join(HISTORY_DIR, file);
        const data = await fs.readFile(filePath, 'utf-8');
        const comparison: ComparisonResult = JSON.parse(data);
        
        history.push({
          id: comparison.id,
          leftImage: comparison.leftImage.fullName,
          rightImage: comparison.rightImage.fullName,
          isSingleImageMode: comparison.isSingleImageMode,
          isIdenticalContent: comparison.isIdenticalContent,
          createdAt: comparison.createdAt,
          summary: this.generateSummary(comparison)
        });
      } catch {
        // Skip invalid files
      }
    }

    return history.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getById(id: string): Promise<ComparisonResult | null> {
    try {
      const filePath = path.join(HISTORY_DIR, `${id}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const filePath = path.join(HISTORY_DIR, `${id}.json`);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async clearAll(): Promise<number> {
    const history = await this.getAll();
    let count = 0;
    for (const entry of history) {
      if (await this.delete(entry.id)) {
        count++;
      }
    }
    return count;
  }

  private async cleanup(): Promise<void> {
    const history = await this.getAll();
    const maxHistory = this.getMaxHistory();
    
    if (history.length > maxHistory) {
      // Delete oldest entries
      const toDelete = history.slice(maxHistory);
      
      for (const entry of toDelete) {
        await this.delete(entry.id);
      }
    }
  }

  private generateSummary(comparison: ComparisonResult) {
    const added = comparison.filesystemDiff.filter(f => f.status === 'added').length;
    const removed = comparison.filesystemDiff.filter(f => f.status === 'removed').length;
    const modified = comparison.filesystemDiff.filter(f => f.status === 'modified').length;
    const total = comparison.filesystemDiff.length;

    let metadataDifferences = 0;
    const meta = comparison.metadata;
    
    if (meta.user?.status !== 'same') metadataDifferences++;
    if (meta.entrypoint?.status !== 'same') metadataDifferences++;
    if (meta.cmd?.status !== 'same') metadataDifferences++;
    if (meta.workingDir?.status !== 'same') metadataDifferences++;
    if (meta.architecture?.status !== 'same') metadataDifferences++;
    if (meta.os?.status !== 'same') metadataDifferences++;
    
    metadataDifferences += meta.env?.filter(e => e.status !== 'same').length || 0;
    metadataDifferences += meta.labels?.filter(l => l.status !== 'same').length || 0;
    metadataDifferences += meta.exposedPorts?.filter(p => p.status !== 'same').length || 0;

    return {
      totalFiles: total,
      addedFiles: added,
      removedFiles: removed,
      modifiedFiles: modified,
      metadataDifferences
    };
  }
}
