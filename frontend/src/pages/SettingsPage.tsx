import { useEffect, useState } from 'react';
import {
  Container,
  Typography,
  Paper,
  TextField,
  Box,
  FormControlLabel,
  Switch,
  Alert,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  CircularProgress,
  LinearProgress,
  InputAdornment,
  Tabs,
  Tab
} from '@mui/material';
import { Delete, Edit, Refresh, Storage, FolderOpen } from '@mui/icons-material';
import { useSettingsStore } from '../store/settings';

interface CacheStats {
  totalSizeGB: number;
  imageCount: number;
  cacheDir: string;
}

interface CacheEntry {
  imageRefs: string[];
  sizeGB: number;
  sizeBytes: number;
  lastModified: string;
  cacheDir: string;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

export default function SettingsPage() {
  const { settings, loading, loadSettings, updateSettings } = useSettingsStore();
  const { credentials, loadCredentials, saveCredential, deleteCredential, testCredential } = useSettingsStore();

  const [activeTab, setActiveTab] = useState(0);
  const [credForm, setCredForm] = useState({ id: '', registry: '', username: '', password: '' });
  const [credTesting, setCredTesting] = useState(false);
  const [credTestResult, setCredTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [newCacheDir, setNewCacheDir] = useState('');
  const [cacheDirChanged, setCacheDirChanged] = useState(false);
  const [movingCache, setMovingCache] = useState(false);

  // Local state for text fields to prevent focus loss on every keystroke
  const [localHttpProxy, setLocalHttpProxy] = useState('');
  const [localNoProxy, setLocalNoProxy] = useState('');
  const [localInsecureRegistries, setLocalInsecureRegistries] = useState('');

  const loadCacheStats = async () => {
    setCacheLoading(true);
    try {
      const res = await fetch('/api/cache/stats');
      if (res.ok) {
        setCacheStats(await res.json());
      }
    } catch (err) {
      console.error('Failed to load cache stats', err);
    }
    setCacheLoading(false);
  };

  const loadCacheEntries = async () => {
    setCacheLoading(true);
    try {
      const res = await fetch('/api/cache/entries');
      if (res.ok) {
        const data = await res.json();
        // Sort by lastModified descending (latest first)
        const sorted = (data.entries || []).sort((a: CacheEntry, b: CacheEntry) => 
          new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
        );
        setCacheEntries(sorted);
      }
    } catch (err) {
      console.error('Failed to load cache entries', err);
    }
    setCacheLoading(false);
  };

  const handleClearCache = async () => {
    if (!confirm('Are you sure you want to clear the entire cache? This will remove all downloaded images.')) {
      return;
    }
    setCacheLoading(true);
    setCacheMessage(null);
    try {
      const res = await fetch('/api/cache/clear', { method: 'POST' });
      if (res.ok) {
        const result = await res.json();
        setCacheMessage({ type: 'success', text: `Cache cleared! Removed ${result.removedCount} entries, freed ${result.freedGB.toFixed(2)} GB` });
        await loadCacheStats();
      } else {
        setCacheMessage({ type: 'error', text: 'Failed to clear cache' });
      }
    } catch (err) {
      setCacheMessage({ type: 'error', text: 'Failed to clear cache' });
    }
    setCacheLoading(false);
  };

  const handleEnforceLimit = async () => {
    if (!settings) return;
    setCacheLoading(true);
    setCacheMessage(null);
    try {
      const res = await fetch('/api/cache/enforce-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxSizeGB: settings.maxCacheSizeGB })
      });
      if (res.ok) {
        const result = await res.json();
        if (result.removedCount > 0) {
          setCacheMessage({ type: 'success', text: `Cleaned up ${result.removedCount} entries, freed ${result.freedGB.toFixed(2)} GB` });
        } else {
          setCacheMessage({ type: 'success', text: 'Cache is within limit, no cleanup needed' });
        }
        await loadCacheStats();
      } else {
        setCacheMessage({ type: 'error', text: 'Failed to enforce cache limit' });
      }
    } catch (err) {
      setCacheMessage({ type: 'error', text: 'Failed to enforce cache limit' });
    }
    setCacheLoading(false);
  };

  const handleCacheDirChange = (value: string) => {
    setNewCacheDir(value);
    setCacheDirChanged(value !== settings?.cacheDir);
  };

  const handleMoveCacheDir = async () => {
    if (!newCacheDir || !cacheDirChanged) return;
    
    setMovingCache(true);
    setCacheMessage({ type: 'info', text: 'Moving cache contents to new location... This may take a while.' });
    
    try {
      const res = await fetch('/api/settings/cache/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCacheDir })
      });
      
      if (res.ok) {
        const result = await res.json();
        setCacheMessage({ 
          type: 'success', 
          text: result.movedFiles > 0 
            ? `Cache moved successfully! ${result.movedFiles} item(s) transferred.`
            : 'Cache location updated (no files to move).'
        });
        setCacheDirChanged(false);
        // Reload settings to get updated cacheDir
        await loadSettings();
        await loadCacheStats();
        await loadCacheEntries();
      } else {
        const err = await res.json();
        setCacheMessage({ type: 'error', text: `Failed to move cache: ${err.message}` });
      }
    } catch (err: any) {
      setCacheMessage({ type: 'error', text: `Failed to move cache: ${err.message}` });
    }
    setMovingCache(false);
  };

  useEffect(() => {
    loadCredentials();
    loadCacheStats();
    loadCacheEntries();
  }, []);

  useEffect(() => {
    if (!settings) {
      loadSettings();
    }
  }, []);

  // Initialize newCacheDir when settings loads
  useEffect(() => {
    if (settings?.cacheDir && !newCacheDir) {
      setNewCacheDir(settings.cacheDir);
    }
  }, [settings?.cacheDir]);

  // Initialize local network settings state when settings loads
  useEffect(() => {
    if (settings) {
      setLocalHttpProxy(settings.httpProxy || '');
      setLocalNoProxy(settings.noProxy || '');
      setLocalInsecureRegistries((settings.insecureRegistries || []).join(', '));
    }
  }, [settings?.httpProxy, settings?.noProxy, settings?.insecureRegistries]);

  if (!settings) return null;

  const handleUpdate = (key: string, value: any) => {
    updateSettings({ [key]: value });
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ mt: 2 }}>
        <Typography variant="h5" gutterBottom>
          Settings
        </Typography>

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
            <Tab label="Main" />
            <Tab label="Cache" />
          </Tabs>
        </Box>

        {/* Main Tab */}
        <TabPanel value={activeTab} index={0}>
          {/* Registry Credentials */}
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Registry Credentials
            </Typography>

            <List>
              {credentials.map(c => (
                <ListItem key={c.id}>
                  <ListItemText primary={c.registry} secondary={`User: ${c.username}`} />
                  <ListItemSecondaryAction>
                    <IconButton edge="end" onClick={() => setCredForm({ id: c.id, registry: c.registry, username: c.username, password: '' })}>
                      <Edit />
                    </IconButton>
                    <IconButton edge="end" onClick={() => deleteCredential(c.id)}>
                      <Delete />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>

            <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <TextField 
                label="Registry" 
                size="small" 
                value={credForm.registry} 
                onChange={e => {
                  setCredForm({ ...credForm, registry: e.target.value });
                  setCredTestResult(null);
                }} 
                sx={{ minWidth: 280 }}
                placeholder="e.g., docker.io, ghcr.io"
                helperText="Only one credential per registry"
                disabled={credTesting}
              />
              <TextField 
                label="Username" 
                size="small" 
                value={credForm.username} 
                onChange={e => {
                  setCredForm({ ...credForm, username: e.target.value });
                  setCredTestResult(null);
                }}
                disabled={credTesting}
              />
              <TextField 
                label="Password / Token" 
                size="small" 
                type="password" 
                value={credForm.password} 
                onChange={e => {
                  setCredForm({ ...credForm, password: e.target.value });
                  setCredTestResult(null);
                }}
                disabled={credTesting}
                helperText={credForm.id ? "Re-enter password to update" : ""}
              />
              <Button 
                variant="contained" 
                disabled={credTesting || !credForm.registry || !credForm.username || !credForm.password}
                onClick={async () => {
                  // First test the credentials
                  setCredTesting(true);
                  setCredTestResult(null);
                  
                  const result = await testCredential(credForm.registry, credForm.username, credForm.password);
                  
                  if (!result.success) {
                    setCredTestResult({ success: false, message: result.error || 'Authentication failed' });
                    setCredTesting(false);
                    return;
                  }
                  
                  // Credentials are valid, proceed to save
                  setCredTestResult({ success: true, message: 'Authentication successful!' });
                  
                  // If editing existing credential (has id), check if registry changed
                  const existingCred = credForm.id ? credentials.find(c => c.id === credForm.id) : null;
                  const registryChanged = existingCred && existingCred.registry.toLowerCase() !== credForm.registry.toLowerCase();
                  
                  // If registry was changed during edit, delete the old credential first
                  if (registryChanged && existingCred) {
                    await deleteCredential(existingCred.id);
                  }
                  
                  const id = credForm.id || `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
                  await saveCredential({ id, name: credForm.registry, registry: credForm.registry, username: credForm.username, password: credForm.password, createdAt: new Date().toISOString() });
                  setCredForm({ id: '', registry: '', username: '', password: '' });
                  setCredTestResult(null);
                  setCredTesting(false);
                }}
              >
                {credTesting ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
                {credTesting ? 'Testing...' : 'Save'}
              </Button>
            </Box>

            {credTestResult && (
              <Alert severity={credTestResult.success ? 'success' : 'error'} sx={{ mt: 2 }}>
                {credTestResult.message}
              </Alert>
            )}
          </Paper>

          {/* Network Settings */}
          <Paper sx={{ p: 3, mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              Network Settings
            </Typography>

            <TextField
              fullWidth
              label="HTTP Proxy URL"
              value={localHttpProxy}
              onChange={(e) => setLocalHttpProxy(e.target.value)}
              onBlur={() => handleUpdate('httpProxy', localHttpProxy)}
              disabled={loading}
              sx={{ mb: 2 }}
              placeholder="e.g., http://proxy.example.com:8080"
              helperText="Optional. Used for all registry connections. Leave empty for direct connection. (Saves on blur)"
            />
            
            <TextField
              fullWidth
              label="No Proxy (hosts to bypass proxy)"
              value={localNoProxy}
              onChange={(e) => setLocalNoProxy(e.target.value)}
              onBlur={() => handleUpdate('noProxy', localNoProxy)}
              disabled={loading}
              sx={{ mb: 2 }}
              placeholder="e.g., localhost,192.168.1.0/24,.internal.local"
              helperText="Comma-separated list of hosts, domains, or CIDR ranges that should bypass the proxy. (Saves on blur)"
            />
            
            {settings.httpProxy && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Proxy configured: {settings.httpProxy}
                {settings.noProxy && <><br />Bypassing proxy for: {settings.noProxy}</>}
              </Alert>
            )}

            <TextField
              fullWidth
              label="Insecure Registries (HTTP only)"
              value={localInsecureRegistries}
              onChange={(e) => setLocalInsecureRegistries(e.target.value)}
              onBlur={() => {
                const registries = localInsecureRegistries.split(',').map(s => s.trim()).filter(s => s);
                handleUpdate('insecureRegistries', registries);
              }}
              disabled={loading}
              sx={{ mb: 2 }}
              placeholder="e.g., localhost:5000, my-registry.internal:5000"
              helperText="Comma-separated list of registries (host:port) that use HTTP instead of HTTPS. (Saves on blur)"
            />
            
            {settings.insecureRegistries && settings.insecureRegistries.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Insecure registries configured (HTTP only): {settings.insecureRegistries.join(', ')}
              </Alert>
            )}
          </Paper>

          {/* Developer Settings */}
          <Paper sx={{ p: 3, mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              Developer Settings
            </Typography>

            <FormControlLabel
              control={
                <Switch
                  checked={settings.skipTlsVerify !== false}
                  onChange={(e) => handleUpdate('skipTlsVerify', e.target.checked)}
                  disabled={loading}
                />
              }
              label="Skip TLS/SSL certificate verification (for self-signed certificates)"
            />
            
            {settings.skipTlsVerify !== false && (
              <Alert severity="info" sx={{ mt: 1 }}>
                Certificate verification is disabled. This allows connections to registries with self-signed or untrusted certificates.
              </Alert>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={settings.debugLogging || false}
                  onChange={(e) => handleUpdate('debugLogging', e.target.checked)}
                  disabled={loading}
                />
              }
              label="Enable debug logging (verbose HTTP details)"
            />
            
            {settings.debugLogging && (
              <Alert severity="info" sx={{ mt: 1 }}>
                Debug logging enabled. Verbose HTTP request/response details will be written to appdata/logs/
              </Alert>
            )}

            <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>
              Server Port Configuration
            </Typography>
            
            <Alert severity="info" sx={{ mb: 2 }}>
              This is the port used to access the application in your browser.
              Restart the application after changing the port setting.
            </Alert>

            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <TextField
                type="number"
                label="Browser Access Port"
                value={settings.frontendPort || 5000}
                onChange={(e) => {
                  const port = parseInt(e.target.value) || 5000;
                  handleUpdate('frontendPort', port);
                }}
                disabled={loading}
                sx={{ width: 200 }}
                helperText="Default: 5000"
              />
            </Box>
          </Paper>

          {/* File System Settings - moved to bottom */}
          <Paper sx={{ p: 3, mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              File System Settings
            </Typography>

            <FormControlLabel
              control={
                <Switch
                  checked={settings.showOnlyDifferences}
                  onChange={(e) => handleUpdate('showOnlyDifferences', e.target.checked)}
                  disabled={loading}
                />
              }
              label="Show only differences by default"
            />

            <FormControlLabel
              control={
                <Switch
                  checked={settings.caseSensitiveSearch}
                  onChange={(e) => handleUpdate('caseSensitiveSearch', e.target.checked)}
                  disabled={loading}
                />
              }
              label="Case-sensitive search by default"
            />

            <TextField
              fullWidth
              type="number"
              label="Max History Items"
              value={settings.maxHistoryItems}
              onChange={(e) => handleUpdate('maxHistoryItems', parseInt(e.target.value))}
              disabled={loading}
              sx={{ mt: 2 }}
            />
          </Paper>
        </TabPanel>

        {/* Cache Tab */}
        <TabPanel value={activeTab} index={1}>
          {/* Cache Settings */}
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                Cache Settings
              </Typography>
              <IconButton onClick={loadCacheStats} disabled={cacheLoading} size="small">
                <Refresh />
              </IconButton>
            </Box>

            {/* Cache Usage Display */}
            {cacheStats && settings && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Cache Usage: {cacheStats.totalSizeGB.toFixed(2)} GB of {settings.maxCacheSizeGB} GB ({cacheStats.imageCount} images)
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={Math.min((cacheStats.totalSizeGB / settings.maxCacheSizeGB) * 100, 100)} 
                  color={cacheStats.totalSizeGB > settings.maxCacheSizeGB ? 'error' : 'primary'}
                  sx={{ height: 8, borderRadius: 1 }}
                />
                {cacheStats.totalSizeGB > settings.maxCacheSizeGB && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Cache exceeds limit. Click "Enforce Limit" to clean up old images.
                  </Alert>
                )}
              </Box>
            )}

            {cacheMessage && (
              <Alert severity={cacheMessage.type} sx={{ mb: 2 }} onClose={() => setCacheMessage(null)}>
                {cacheMessage.text}
              </Alert>
            )}

            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                fullWidth
                label="Cache Directory"
                value={newCacheDir}
                onChange={(e) => handleCacheDirChange(e.target.value)}
                disabled={movingCache}
                helperText={cacheDirChanged ? "Click 'Apply' to move cache to this location" : "Enter a new path to move the cache"}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <FolderOpen fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                variant="contained"
                color="primary"
                onClick={handleMoveCacheDir}
                disabled={!cacheDirChanged || movingCache}
                sx={{ minWidth: 100, height: 56 }}
              >
                {movingCache ? <CircularProgress size={20} /> : 'Apply'}
              </Button>
            </Box>

            <TextField
              fullWidth
              type="number"
              label="Max Cache Size (GB)"
              value={settings.maxCacheSizeGB}
              onChange={(e) => handleUpdate('maxCacheSizeGB', parseInt(e.target.value))}
              disabled={loading}
              sx={{ mb: 2 }}
            />

            <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
              <Button 
                variant="outlined" 
                color="primary" 
                onClick={handleEnforceLimit}
                disabled={cacheLoading || !cacheStats}
              >
                {cacheLoading ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
                Enforce Limit
              </Button>
              <Button 
                variant="outlined" 
                color="error" 
                onClick={handleClearCache}
                disabled={cacheLoading || !cacheStats || cacheStats.imageCount === 0}
              >
                {cacheLoading ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
                Clear All Cache
              </Button>
            </Box>
          </Paper>

          {/* Cache Explorer */}
          <Paper sx={{ p: 3, mt: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                <Storage sx={{ mr: 1, verticalAlign: 'middle' }} />
                Cache Explorer
              </Typography>
              <IconButton onClick={() => { loadCacheStats(); loadCacheEntries(); }} disabled={cacheLoading} size="small">
                <Refresh />
              </IconButton>
            </Box>

            {cacheLoading && <LinearProgress sx={{ mb: 2 }} />}

            {cacheEntries.length === 0 ? (
              <Typography color="text.secondary" align="center" sx={{ py: 3 }}>No cached images</Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {cacheEntries.map((entry, idx) => (
                  <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Typography variant="subtitle2" color="text.secondary">Image References</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                          {entry.sizeGB >= 1 
                            ? `${entry.sizeGB.toFixed(2)} GB` 
                            : `${(entry.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {new Date(entry.lastModified).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
                          })}
                        </Typography>
                        <IconButton 
                          size="small"
                          onClick={async () => {
                            const dirName = entry.cacheDir ? entry.cacheDir.split(/[\\/]/).pop() : null;
                            if (!dirName) return;
                            if (!confirm(`Delete cached image(s):\n${entry.imageRefs.join('\n')}\n\nThis will remove ${entry.sizeGB >= 1 ? entry.sizeGB.toFixed(2) + ' GB' : (entry.sizeBytes / 1024 / 1024).toFixed(1) + ' MB'} of data.`)) {
                              return;
                            }
                            try {
                              const res = await fetch(`/api/cache/entry/${encodeURIComponent(dirName)}`, { method: 'DELETE' });
                              if (res.ok) {
                                setCacheMessage({ type: 'success', text: 'Cache entry deleted successfully' });
                                await loadCacheStats();
                                await loadCacheEntries();
                              } else {
                                setCacheMessage({ type: 'error', text: 'Failed to delete cache entry' });
                              }
                            } catch {
                              setCacheMessage({ type: 'error', text: 'Failed to delete cache entry' });
                            }
                          }}
                          title="Delete this cached image"
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>
                    {entry.imageRefs.map((ref, i) => (
                      <Typography 
                        key={i}
                        variant="body2" 
                        sx={{ 
                          fontFamily: 'monospace', 
                          fontSize: '0.8rem',
                          wordBreak: 'break-all',
                          mb: i < entry.imageRefs.length - 1 ? 0.5 : 0
                        }}
                      >
                        {ref}
                      </Typography>
                    ))}
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      Cache folder: {entry.cacheDir ? entry.cacheDir.split(/[\\/]/).pop() : '-'}
                    </Typography>
                  </Paper>
                ))}
              </Box>
            )}
          </Paper>
        </TabPanel>
      </Box>
    </Container>
  );
}
