import { 
  ComparisonResult, 
  FileDiff, 
  MetadataDiff, 
  FileNode, 
  DiffStatus,
  EnvVarDiff,
  LabelDiff
} from '../../../shared/types';
import { CachedImageData } from './imageCacheOCI';
import * as diff from 'diff';

export class ComparisonService {
  compareImages(left: CachedImageData, right: CachedImageData, comparisonId: string): ComparisonResult {
    // Check if different image names but same digest (identical content)
    const isIdenticalContent = left.imageRef.fullName !== right.imageRef.fullName && 
      !!(left.digest && right.digest && left.digest === right.digest);
    // Single image mode when same image ref OR same digest (identical content)
    const isSingleImageMode = left.imageRef.fullName === right.imageRef.fullName ||
      !!(left.digest && right.digest && left.digest === right.digest);
    
    const metadataDiff = this.compareMetadata(left.config, right.config);
    const filesystemDiff = this.compareFilesystems(left.filesystem, right.filesystem);
    const mergedTree = this.buildMergedTree(left.filesystem, right.filesystem);

    // Enhance image references with additional details
    const leftImageRef = {
      ...left.imageRef,
      digest: left.digest,
      manifestDigest: left.manifestDigest, // Platform-specific manifest digest (for Kubernetes pod spec)
      indexDigest: left.indexDigest, // Manifest list/index digest (what "docker images --digests" shows)
      sizeBytes: left.sizeBytes,
      compressedSizeBytes: left.compressedSizeBytes, // Compressed size (like "docker images" shows)
      created: left.config?.created
    };
    const rightImageRef = {
      ...right.imageRef,
      digest: right.digest,
      manifestDigest: right.manifestDigest, // Platform-specific manifest digest (for Kubernetes pod spec)
      indexDigest: right.indexDigest, // Manifest list/index digest (what "docker images --digests" shows)
      sizeBytes: right.sizeBytes,
      compressedSizeBytes: right.compressedSizeBytes, // Compressed size (like "docker images" shows)
      created: right.config?.created
    };

    return {
      id: comparisonId,
      leftImage: leftImageRef,
      rightImage: rightImageRef,
      metadata: metadataDiff,
      filesystemDiff,
      fileTree: {
        left: left.filesystem,
        right: right.filesystem,
        merged: mergedTree
      },
      createdAt: new Date().toISOString(),
      cacheStatus: {
        leftCached: true,
        rightCached: true
      },
      isSingleImageMode,
      isIdenticalContent
    };
  }

  private compareMetadata(leftConfig: any, rightConfig: any): MetadataDiff {
    const left = leftConfig.config || {};
    const right = rightConfig.config || {};

    const result: MetadataDiff = {};

    // User
    if (left.User || right.User) {
      result.user = {
        left: left.User,
        right: right.User,
        status: this.getDiffStatus(left.User, right.User)
      };
    }

    // Entrypoint
    if (left.Entrypoint || right.Entrypoint) {
      result.entrypoint = {
        left: left.Entrypoint,
        right: right.Entrypoint,
        status: this.getDiffStatus(
          JSON.stringify(left.Entrypoint),
          JSON.stringify(right.Entrypoint)
        )
      };
    }

    // Cmd
    if (left.Cmd || right.Cmd) {
      result.cmd = {
        left: left.Cmd,
        right: right.Cmd,
        status: this.getDiffStatus(
          JSON.stringify(left.Cmd),
          JSON.stringify(right.Cmd)
        )
      };
    }

    // WorkingDir
    if (left.WorkingDir || right.WorkingDir) {
      result.workingDir = {
        left: left.WorkingDir,
        right: right.WorkingDir,
        status: this.getDiffStatus(left.WorkingDir, right.WorkingDir)
      };
    }

    // Environment variables
    result.env = this.compareEnvVars(left.Env || [], right.Env || []);

    // Labels
    result.labels = this.compareLabels(left.Labels || {}, right.Labels || {});

    // Exposed ports
    const leftPorts = Object.keys(left.ExposedPorts || {});
    const rightPorts = Object.keys(right.ExposedPorts || {});
    result.exposedPorts = this.comparePorts(leftPorts, rightPorts);

    // Architecture & OS
    result.architecture = {
      left: leftConfig.architecture,
      right: rightConfig.architecture,
      status: this.getDiffStatus(leftConfig.architecture, rightConfig.architecture)
    };

    result.os = {
      left: leftConfig.os,
      right: rightConfig.os,
      status: this.getDiffStatus(leftConfig.os, rightConfig.os)
    };

    return result;
  }

  private compareEnvVars(leftEnv: string[], rightEnv: string[]): EnvVarDiff[] {
    const leftMap = new Map<string, string>();
    const rightMap = new Map<string, string>();

    leftEnv.forEach(env => {
      const [key, ...valueParts] = env.split('=');
      leftMap.set(key, valueParts.join('='));
    });

    rightEnv.forEach(env => {
      const [key, ...valueParts] = env.split('=');
      rightMap.set(key, valueParts.join('='));
    });

    const allKeys = new Set([...leftMap.keys(), ...rightMap.keys()]);
    const diffs: EnvVarDiff[] = [];

    allKeys.forEach(key => {
      const leftValue = leftMap.get(key);
      const rightValue = rightMap.get(key);

      diffs.push({
        key,
        leftValue,
        rightValue,
        status: this.getDiffStatus(leftValue, rightValue)
      });
    });

    return diffs.sort((a, b) => a.key.localeCompare(b.key));
  }

  private compareLabels(leftLabels: Record<string, string>, rightLabels: Record<string, string>): LabelDiff[] {
    const allKeys = new Set([...Object.keys(leftLabels), ...Object.keys(rightLabels)]);
    const diffs: LabelDiff[] = [];

    allKeys.forEach(key => {
      diffs.push({
        key,
        leftValue: leftLabels[key],
        rightValue: rightLabels[key],
        status: this.getDiffStatus(leftLabels[key], rightLabels[key])
      });
    });

    return diffs.sort((a, b) => a.key.localeCompare(b.key));
  }

  private comparePorts(leftPorts: string[], rightPorts: string[]): any[] {
    const allPorts = new Set([...leftPorts, ...rightPorts]);
    const diffs: any[] = [];

    allPorts.forEach(port => {
      const inLeft = leftPorts.includes(port);
      const inRight = rightPorts.includes(port);

      let status: DiffStatus;
      if (inLeft && inRight) status = 'same';
      else if (inLeft) status = 'left-only';
      else status = 'right-only';

      diffs.push({ port, status });
    });

    return diffs.sort((a, b) => a.port.localeCompare(b.port));
  }

  private compareFilesystems(left: FileNode, right: FileNode): FileDiff[] {
    const diffs: FileDiff[] = [];
    const leftFiles = new Map<string, FileNode>();
    const rightFiles = new Map<string, FileNode>();
    const leftDirs = new Map<string, FileNode>();
    const rightDirs = new Map<string, FileNode>();

    // Collect all files and directories
    this.collectFilesAndDirs(left, leftFiles, leftDirs);
    this.collectFilesAndDirs(right, rightFiles, rightDirs);

    // Process directories for color coding
    const allDirPaths = new Set([...leftDirs.keys(), ...rightDirs.keys()]);
    allDirPaths.forEach(dirPath => {
      const leftDir = leftDirs.get(dirPath);
      const rightDir = rightDirs.get(dirPath);

      if (!leftDir && rightDir) {
        diffs.push({
          path: dirPath,
          status: 'added',
          rightMode: rightDir.mode
        });
      } else if (leftDir && !rightDir) {
        diffs.push({
          path: dirPath,
          status: 'removed',
          leftMode: leftDir.mode
        });
      } else if (leftDir && rightDir) {
        // Both exist - check permissions
        if (leftDir.mode !== rightDir.mode) {
          diffs.push({
            path: dirPath,
            status: 'modified',
            leftMode: leftDir.mode,
            rightMode: rightDir.mode
          });
        } else {
          diffs.push({
            path: dirPath,
            status: 'same',
            leftMode: leftDir.mode,
            rightMode: rightDir.mode
          });
        }
      }
    });

    // Process files
    const allPaths = new Set([...leftFiles.keys(), ...rightFiles.keys()]);

    allPaths.forEach(filePath => {
      const leftFile = leftFiles.get(filePath);
      const rightFile = rightFiles.get(filePath);

      if (!leftFile) {
        diffs.push({
          path: filePath,
          status: 'added',
          rightSize: rightFile?.size,
          rightMode: rightFile?.mode
        });
      } else if (!rightFile) {
        diffs.push({
          path: filePath,
          status: 'removed',
          leftSize: leftFile?.size,
          leftMode: leftFile?.mode
        });
      } else {
        // Both exist - check if modified
        const sameSize = leftFile.size === rightFile.size;
        const sameMode = leftFile.mode === rightFile.mode;
        const sameType = leftFile.type === rightFile.type;

        if (sameSize && sameMode && sameType) {
          diffs.push({
            path: filePath,
            status: 'same',
            leftSize: leftFile.size,
            rightSize: rightFile.size,
            leftMode: leftFile.mode,
            rightMode: rightFile.mode
          });
        } else {
          diffs.push({
            path: filePath,
            status: 'modified',
            leftSize: leftFile.size,
            rightSize: rightFile.size,
            leftMode: leftFile.mode,
            rightMode: rightFile.mode
          });
        }
      }
    });

    return diffs.sort((a, b) => a.path.localeCompare(b.path));
  }

  private collectFilesAndDirs(node: FileNode, fileMap: Map<string, FileNode>, dirMap: Map<string, FileNode>): void {
    if (node.type === 'directory') {
      // Only add non-root directories
      if (node.path !== '/') {
        dirMap.set(node.path, node);
      }
    } else {
      fileMap.set(node.path, node);
    }

    if (node.children) {
      node.children.forEach(child => this.collectFilesAndDirs(child, fileMap, dirMap));
    }
  }

  private collectFiles(node: FileNode, map: Map<string, FileNode>): void {
    if (node.type !== 'directory') {
      map.set(node.path, node);
    }

    if (node.children) {
      node.children.forEach(child => this.collectFiles(child, map));
    }
  }

  private buildMergedTree(left: FileNode, right: FileNode): FileNode {
    const mergedChildren: FileNode[] = [];
    
    // Normalize children - remove duplicates caused by path inconsistencies
    const normalizeChildren = (children?: FileNode[]) => {
      if (!children) return new Map<string, FileNode>();
      
      const map = new Map<string, FileNode>();
      children.forEach(child => {
        // Use normalized name as key (case-sensitive, but handle path variations)
        const normalizedName = child.name.toLowerCase().trim();
        const existing = map.get(normalizedName);
        
        if (!existing) {
          map.set(normalizedName, child);
        } else {
          // Merge duplicates - prefer the one with more children or metadata
          const existingChildCount = existing.children?.length || 0;
          const newChildCount = child.children?.length || 0;
          
          // Select the better version as base
          const preferred = newChildCount > existingChildCount ? child : existing;
          const other = newChildCount > existingChildCount ? existing : child;
          
          // Merge metadata from both versions
          const merged: FileNode = {
            ...preferred,
            mode: preferred.mode || other.mode,
            size: preferred.size ?? other.size,
            uid: preferred.uid ?? other.uid,
            gid: preferred.gid ?? other.gid,
            mtime: preferred.mtime || other.mtime,
            linkname: preferred.linkname || other.linkname,
          };
          
          map.set(normalizedName, merged);
        }
      });
      
      return map;
    };
    
    const leftChildMap = normalizeChildren(left.children);
    const rightChildMap = normalizeChildren(right.children);

    const allNames = new Set([
      ...Array.from(leftChildMap.keys()),
      ...Array.from(rightChildMap.keys())
    ]);

    allNames.forEach(name => {
      const leftChild = leftChildMap.get(name);
      const rightChild = rightChildMap.get(name);

      if (leftChild && rightChild) {
        if (leftChild.type === 'directory' && rightChild.type === 'directory') {
          // Merge directories recursively
          mergedChildren.push(this.buildMergedTree(leftChild, rightChild));
        } else {
          // For files, use left version (metadata will be in tree)
          mergedChildren.push(leftChild);
        }
      } else if (leftChild) {
        mergedChildren.push(leftChild);
      } else if (rightChild) {
        mergedChildren.push(rightChild);
      }
    });

    return {
      path: left.path || right.path,
      name: left.name || right.name,
      type: 'directory',
      mode: left.mode || right.mode,
      children: mergedChildren.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      })
    };
  }

  private getDiffStatus(left: any, right: any): DiffStatus {
    if (left === undefined && right === undefined) return 'same';
    if (left === undefined) return 'right-only';
    if (right === undefined) return 'left-only';
    return left === right ? 'same' : 'different';
  }

  compareFileContent(leftContent: string, rightContent: string): any {
    const patches = diff.createPatch('file', leftContent, rightContent, '', '');
    const lines = patches.split('\n').slice(4); // Skip header
    
    const hunks: any[] = [];
    let currentHunk: any = null;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        if (currentHunk) hunks.push(currentHunk);
        
        const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (match) {
          currentHunk = {
            oldStart: parseInt(match[1]),
            oldLines: parseInt(match[2] || '1'),
            newStart: parseInt(match[3]),
            newLines: parseInt(match[4] || '1'),
            lines: []
          };
        }
      } else if (currentHunk) {
        let type: 'add' | 'delete' | 'context' = 'context';
        if (line.startsWith('+')) type = 'add';
        else if (line.startsWith('-')) type = 'delete';

        currentHunk.lines.push({
          type,
          content: line.substring(1)
        });
      }
    }

    if (currentHunk) hunks.push(currentHunk);

    return { hunks };
  }
}
