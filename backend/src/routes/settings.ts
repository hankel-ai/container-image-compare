import { Router } from 'express';
import axios from 'axios';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import { settingsService, APP_PATHS } from '../services/settings';

const router = Router();

settingsService.init();

// Get app paths (for E2E tests, etc.)
router.get('/paths', async (req, res) => {
  res.json(APP_PATHS);
});

// Get settings
router.get('/', async (req, res) => {
  try {
    const settings = await settingsService.get();
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Update settings
router.put('/', async (req, res) => {
  try {
    const updates = req.body;
    const settings = await settingsService.update(updates);
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Reset settings to default
router.post('/reset', async (req, res) => {
  try {
    const settings = await settingsService.reset();
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({
      error: 'Server Error',
      message: error.message
    });
  }
});

// Credentials CRUD
router.get('/credentials', async (req, res) => {
  try {
    const creds = await settingsService.getCredentials();
    res.json(creds);
  } catch (error: any) {
    res.status(500).json({ error: 'Server Error', message: error.message });
  }
});

// Test registry credentials before saving
router.post('/credentials/test', async (req, res) => {
  try {
    const { registry, username, password } = req.body;
    if (!registry || !username || !password) {
      return res.json({ success: false, error: 'Registry, username and password are required' });
    }

    // Trim whitespace from inputs
    const trimmedRegistry = registry.trim();
    const trimmedUsername = username.trim();

    // Get current settings for proxy and TLS settings
    const settings = await settingsService.get();
    
    // Normalize registry input
    let registryInput = trimmedRegistry.toLowerCase();
    // Handle docker.io shorthand
    if (registryInput === 'docker.io' || registryInput === 'hub.docker.com') {
      registryInput = 'registry-1.docker.io';
    }
    // Remove protocol if present
    registryInput = registryInput.replace(/^https?:\/\//, '');
    // Remove trailing slash
    registryInput = registryInput.replace(/\/+$/, '');
    
    // Extract hostname only - the path (like /testreg for Harbor projects) is NOT part of v2 API URL
    // The Docker v2 API is always at /v2/ on the registry host
    const registryHost = registryInput.split('/')[0];

    // Determine if this registry should use HTTP
    const isInsecure = (settings.insecureRegistries || []).some(
      r => r.toLowerCase() === registryHost || registryHost.startsWith(r.toLowerCase())
    );
    const protocol = isInsecure ? 'http' : 'https';

    // Check if this host should bypass proxy (same logic as main registry code)
    const shouldBypassProxy = (host: string): boolean => {
      if (!settings.noProxy) return false;
      const noProxyList = settings.noProxy.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
      const hostLower = host.toLowerCase();
      for (const entry of noProxyList) {
        if (entry === '*') return true;
        if (entry.startsWith('*.')) {
          const suffix = entry.slice(1);
          if (hostLower.endsWith(suffix) || hostLower === entry.slice(2)) return true;
        } else if (entry.startsWith('.')) {
          if (hostLower.endsWith(entry) || hostLower === entry.slice(1)) return true;
        } else if (hostLower === entry || hostLower.endsWith('.' + entry)) {
          return true;
        }
      }
      return false;
    };

    // Configure axios instance with proper proxy agent (like main registry code)
    const axiosConfig: any = {
      timeout: 15000,
      proxy: false // Disable axios built-in proxy, we use agents
    };

    // Use HttpsProxyAgent for HTTPS or HttpProxyAgent for HTTP (same as imageCacheOCI.ts)
    const useProxy = settings.httpProxy && !shouldBypassProxy(registryHost);
    
    if (protocol === 'https') {
      if (useProxy && settings.httpProxy) {
        // Use HTTPS proxy agent with TLS settings
        axiosConfig.httpsAgent = new HttpsProxyAgent(settings.httpProxy, {
          rejectUnauthorized: !settings.skipTlsVerify
        });
      } else if (settings.skipTlsVerify) {
        // No proxy but skip TLS verification
        axiosConfig.httpsAgent = new https.Agent({ rejectUnauthorized: false });
      }
    } else {
      // HTTP (insecure registry)
      if (useProxy && settings.httpProxy) {
        axiosConfig.httpAgent = new HttpProxyAgent(settings.httpProxy);
      }
    }

    // Docker v2 API is always at /v2/ on the registry host (not under project paths)
    const v2Url = `${protocol}://${registryHost}/v2/`;
    
    // BEST APPROACH: Try Basic auth directly first - this is the most reliable way
    // to test credentials. Many registries (Harbor, Artifactory, etc.) support both
    // Basic and Bearer auth, and Basic auth gives a clear 401 for bad credentials.
    let basicAuthResponse;
    try {
      basicAuthResponse = await axios.get(v2Url, {
        ...axiosConfig,
        auth: { username: trimmedUsername, password },
        validateStatus: () => true
      });
    } catch (networkErr: any) {
      // Network-level errors (DNS, connection refused, etc.)
      if (networkErr.code === 'ENOTFOUND') {
        return res.json({ success: false, error: `Registry not found: ${registryHost}` });
      }
      if (networkErr.code === 'ECONNREFUSED') {
        return res.json({ success: false, error: `Connection refused by ${registryHost}` });
      }
      if (networkErr.code === 'ETIMEDOUT' || networkErr.code === 'ECONNABORTED') {
        return res.json({ success: false, error: `Connection timed out to ${registryHost}` });
      }
      if (networkErr.code === 'ECONNRESET') {
        return res.json({ success: false, error: `Connection reset by ${registryHost}` });
      }
      if (networkErr.code === 'CERT_HAS_EXPIRED' || networkErr.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        return res.json({ success: false, error: `TLS/SSL certificate error for ${registryHost}` });
      }
      return res.json({ success: false, error: `Cannot connect to registry: ${networkErr.message}` });
    }

    // If Basic auth worked (200), we're done!
    if (basicAuthResponse.status === 200) {
      return res.json({ success: true, message: 'Authentication successful' });
    }
    
    // If we got 401 with Basic realm in the header, credentials are definitely wrong
    const wwwAuth = basicAuthResponse.headers['www-authenticate'] || '';
    if (basicAuthResponse.status === 401 && wwwAuth.toLowerCase().includes('basic')) {
      return res.json({ success: false, error: 'Authentication failed: Invalid username or password' });
    }
    
    // For Bearer token auth (like Docker Hub), we need to go through the token flow
    if (basicAuthResponse.status === 401 && wwwAuth.toLowerCase().includes('bearer')) {
      const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
      const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
      
      if (realmMatch) {
        const realm = realmMatch[1];
        const service = serviceMatch ? serviceMatch[1] : '';
        
        // Request token WITH credentials but WITHOUT scope
        // This tests if the credentials are valid without requiring specific permissions
        const tokenUrl = new URL(realm);
        if (service) tokenUrl.searchParams.set('service', service);
        
        let tokenResponse;
        try {
          tokenResponse = await axios.get(tokenUrl.toString(), {
            ...axiosConfig,
            auth: { username: trimmedUsername, password },
            validateStatus: () => true
          });
        } catch (tokenErr: any) {
          return res.json({ success: false, error: `Failed to authenticate: ${tokenErr.message}` });
        }
        
        if (tokenResponse.status === 401) {
          return res.json({ success: false, error: 'Authentication failed: Invalid username or password' });
        }
        
        if (tokenResponse.status === 403) {
          return res.json({ success: false, error: 'Authentication failed: Access denied' });
        }
        
        if (tokenResponse.status !== 200) {
          return res.json({ success: false, error: `Authentication failed: HTTP ${tokenResponse.status}` });
        }
        
        const token = tokenResponse.data?.token || tokenResponse.data?.access_token;
        if (!token) {
          return res.json({ success: false, error: 'Authentication failed: No token received' });
        }
        
        // Verify the token works by calling v2 with it
        const tokenVerifyResponse = await axios.get(v2Url, {
          ...axiosConfig,
          headers: { 'Authorization': `Bearer ${token}` },
          validateStatus: () => true
        });
        
        if (tokenVerifyResponse.status === 200) {
          return res.json({ success: true, message: 'Authentication successful' });
        } else {
          return res.json({ success: false, error: 'Authentication failed: Token not accepted by registry' });
        }
      }
    }
    
    // Check for server errors
    if (basicAuthResponse.status >= 500) {
      return res.json({ success: false, error: `Registry server error: HTTP ${basicAuthResponse.status}` });
    }
    
    if (basicAuthResponse.status === 404) {
      return res.json({ success: false, error: `Registry API not found at ${registryHost} - is this a valid container registry?` });
    }
    
    // Any other 401 without clear auth method
    if (basicAuthResponse.status === 401) {
      return res.json({ success: false, error: 'Authentication failed: Invalid username or password' });
    }

    // Unexpected response
    return res.json({ success: false, error: `Unexpected response from registry: HTTP ${basicAuthResponse.status}` });
    
  } catch (error: any) {
    // Catch-all for any unexpected errors
    console.error('Credential test error:', error);
    return res.json({ success: false, error: error.message || 'Unknown error occurred' });
  }
});

router.post('/credentials', async (req, res) => {
  try {
    const cred = req.body;
    // Basic validation
    if (!cred || !cred.id || !cred.registry || !cred.username) {
      return res.status(400).json({ error: 'Bad Request', message: 'id, registry and username are required' });
    }

    // Trim whitespace from registry and username before saving
    cred.registry = cred.registry.trim();
    cred.username = cred.username.trim();
    if (cred.name) cred.name = cred.name.trim();

    const saved = await settingsService.addOrUpdateCredential(cred);
    res.json(saved);
  } catch (error: any) {
    res.status(500).json({ error: 'Server Error', message: error.message });
  }
});

router.delete('/credentials/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await settingsService.deleteCredential(id);
    res.status(204).end();
  } catch (error: any) {
    res.status(500).json({ error: 'Server Error', message: error.message });
  }
});

// Move cache to a new location
router.post('/cache/move', async (req, res) => {
  try {
    const { newCacheDir } = req.body;
    if (!newCacheDir || typeof newCacheDir !== 'string') {
      return res.status(400).json({ error: 'Bad Request', message: 'newCacheDir is required' });
    }
    
    const result = await settingsService.moveCache(newCacheDir);
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({ error: 'Move Failed', message: result.error });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Server Error', message: error.message });
  }
});

export default router;
