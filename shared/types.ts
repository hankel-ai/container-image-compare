// Shared TypeScript types for frontend and backend

export interface ImageReference {
  registry: string;
  repository: string;
  tag: string;
  fullName: string; // e.g., "docker.io/library/nginx:latest"
  digest?: string;  // Config digest (Image ID)
  manifestDigest?: string;  // Platform-specific manifest digest (for Kubernetes pod spec)
  indexDigest?: string;  // Manifest list/index digest (what "docker images --digests" shows)
  sizeBytes?: number;  // Total image size (uncompressed)
  compressedSizeBytes?: number;  // Compressed size (like "docker images" shows)
  created?: string;  // Image creation date
}

export interface RegistryCredential {
  id: string;
  name: string;
  registry: string; // e.g., "docker.io", "ghcr.io"
  username: string;
  password: string; // encrypted on backend
  createdAt: string;
}

// Note: skipTlsVerify is part of AppSettings - search for AppSettings to see full interface

export interface ImageMetadata {
  config: {
    User?: string;
    ExposedPorts?: Record<string, unknown>;
    Env?: string[];
    Entrypoint?: string[];
    Cmd?: string[];
    WorkingDir?: string;
    Labels?: Record<string, string>;
  };
  architecture: string;
  os: string;
  created: string;
  author?: string;
  layers: string[];
}

export interface FileNode {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  mode?: string;
  uid?: number;
  gid?: number;
  mtime?: Date;
  modifiedTime?: string;
  linkTarget?: string;
  linkname?: string;
  children?: FileNode[];
}

export interface FileDiff {
  path: string;
  status: 'added' | 'removed' | 'modified' | 'same';
  leftSize?: number;
  rightSize?: number;
  leftMode?: string;
  rightMode?: string;
  isBinary?: boolean;
}

export interface FileContentDiff {
  path: string;
  leftContent: string;
  rightContent: string;
  isBinary: boolean;
  hunks?: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  lineNumber?: number;
}

export interface MetadataDiff {
  user?: { left?: string; right?: string; status: DiffStatus };
  entrypoint?: { left?: string[]; right?: string[]; status: DiffStatus };
  cmd?: { left?: string[]; right?: string[]; status: DiffStatus };
  workingDir?: { left?: string; right?: string; status: DiffStatus };
  env?: EnvVarDiff[];
  labels?: LabelDiff[];
  exposedPorts?: PortDiff[];
  architecture?: { left: string; right: string; status: DiffStatus };
  os?: { left: string; right: string; status: DiffStatus };
}

export interface EnvVarDiff {
  key: string;
  leftValue?: string;
  rightValue?: string;
  status: DiffStatus;
}

export interface LabelDiff {
  key: string;
  leftValue?: string;
  rightValue?: string;
  status: DiffStatus;
}

export interface PortDiff {
  port: string;
  status: DiffStatus;
}

export type DiffStatus = 'same' | 'different' | 'left-only' | 'right-only';

export interface ComparisonResult {
  id: string;
  leftImage: ImageReference;
  rightImage: ImageReference;
  metadata: MetadataDiff;
  filesystemDiff: FileDiff[];
  fileTree: {
    left: FileNode;
    right: FileNode;
    merged: FileNode; // Tree with diff annotations
  };
  createdAt: string;
  cacheStatus: {
    leftCached: boolean;
    rightCached: boolean;
  };
  isSingleImageMode?: boolean; // True when inspecting a single image (left === right)
  isIdenticalContent?: boolean; // True when different image names have same digest/content
}

export interface ComparisonRequest {
  leftImage: string;
  rightImage: string;
  leftCredentialId?: string;
  rightCredentialId?: string;
}

export interface AppSettings {
  cacheDir: string;
  maxCacheSizeGB: number;
  maxHistoryItems: number;
  theme: 'light' | 'dark' | 'auto';
  showOnlyDifferences: boolean;
  caseSensitiveSearch: boolean;
  debugLogging: boolean;
  frontendPort: number;
  skipTlsVerify: boolean;  // Skip TLS/SSL certificate verification for self-signed certs
  httpProxy?: string;  // HTTP proxy URL (e.g., http://proxy:8080)
  noProxy?: string;  // Comma-separated list of hosts to bypass proxy (e.g., localhost,192.168.1.0/24)
  insecureRegistries?: string[];  // List of registries that use HTTP instead of HTTPS
}

export interface ComparisonHistory {
  id: string;
  leftImage: string;
  rightImage: string;
  isSingleImageMode?: boolean;
  isIdenticalContent?: boolean; // Different image names with same digest
  createdAt: string;
  summary: {
    totalFiles: number;
    addedFiles: number;
    removedFiles: number;
    modifiedFiles: number;
    metadataDifferences: number;
  };
}

export interface RecentImage {
  imageRef: string;
  lastUsed: string;
}

export interface DownloadRequest {
  comparisonId: string;
  imageSide: 'left' | 'right';
  path: string;
  type: 'file' | 'directory';
}

export interface CacheInfo {
  totalSizeGB: number;
  maxSizeGB: number;
  images: CachedImage[];
}

export interface CachedImage {
  fullName: string;
  sizeGB: number;
  lastAccessed: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
