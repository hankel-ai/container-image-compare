import axios, { AxiosInstance } from 'axios';
import { ImageReference, RegistryCredential } from '../../../shared/types';
import { getAxiosConfig, getRegistryProtocol } from './imageCacheOCI';

interface ManifestLayer {
  digest: string;
  size: number;
  mediaType: string;
}

interface Manifest {
  schemaVersion: number;
  mediaType: string;
  config: {
    digest: string;
    size: number;
    mediaType: string;
  };
  layers: ManifestLayer[];
}

export class DockerRegistryClient {
  private client: AxiosInstance;
  private token?: string;
  private protocol: 'http' | 'https';

  constructor(private registry: string, private credential?: RegistryCredential) {
    // Determine protocol based on insecure registries setting
    this.protocol = getRegistryProtocol(registry);
    
    // Get proxy and TLS config (passing registry for noProxy check)
    const axiosConfig = getAxiosConfig(registry);
    
    this.client = axios.create({
      timeout: 30000,
      headers: {
        'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
      },
      auth: credential ? { username: credential.username, password: credential.password } : undefined,
      ...axiosConfig
    });
  }

  private maskHeaderForLog(headers: any) {
    const out: any = {};
    if (!headers) return out;
    for (const k of Object.keys(headers)) {
      const v = headers[k];
      if (!v) continue;
      if (typeof v === 'string' && v.toLowerCase().startsWith('bearer ')) {
        const t = v.slice(7);
        out[k] = `Bearer ${t.slice(0, 6)}...`;
        continue;
      }
      out[k] = v;
    }
    return out;
  }

  private async loggedGet(url: string, config?: any) {
    try {
      console.log(`HTTP REQUEST -> GET ${url}`);
      // Merge instance defaults with per-request config so headers/auth set on the instance are used
      const mergedConfig = Object.assign({}, config || {});
      if (!mergedConfig.headers) mergedConfig.headers = {};
      // copy instance default headers (if any) into merged headers without overwriting explicit per-request headers
      try {
        const defaultHeaders = (this.client.defaults && this.client.defaults.headers) || {};
        // axios instance default headers may be nested by method; copy common headers
        if (defaultHeaders.common) Object.assign(mergedConfig.headers, defaultHeaders.common);
        Object.keys(defaultHeaders).forEach(k => {
          if (k !== 'common') Object.assign(mergedConfig.headers, defaultHeaders[k]);
        });
      } catch (e) {
        // ignore
      }

      const logged = this.maskHeaderForLog(mergedConfig.headers);
      if (Object.keys(logged).length) console.log('Request headers ->', JSON.stringify(logged));

      // Determine auth used for logging (prefer per-request auth, otherwise instance credential)
      const auth = config?.auth || this.credential || undefined;
      if (auth && auth.username) {
        console.log(`Request auth -> username=${auth.username}, password=*****`);
      }

      // Use the axios instance so instance-level settings (timeout, auth, default headers) are applied
      const resp = await this.client.get(url, Object.assign({}, mergedConfig, { validateStatus: () => true }));
      console.log(`HTTP RESPONSE -> ${resp.status} from ${url}`);
      try { console.log('Response headers ->', JSON.stringify(resp.headers)); } catch (e) { console.log('Response headers ->', resp.headers); }
      try { console.log('Response data ->', JSON.stringify(resp.data)); } catch (e) { /* ignore large bodies */ }
      return resp;
    } catch (err) {
      console.log('HTTP REQUEST ERROR ->', (err as any)?.message || err);
      throw err;
    }
  }

  private parseImageReference(imageRef: string): ImageReference {
    let registry = 'registry-1.docker.io'; // Docker Hub default
    let repository = imageRef;
    let tag = 'latest';

    // Extract tag
    if (imageRef.includes(':')) {
      const parts = imageRef.split(':');
      tag = parts[parts.length - 1];
      repository = parts.slice(0, -1).join(':');
    }

    // Extract registry
    if (repository.includes('/')) {
      const parts = repository.split('/');
      if (parts[0].includes('.') || parts[0].includes(':')) {
        registry = parts[0];
        repository = parts.slice(1).join('/');
      }
    }

    // Docker Hub library images
    if (registry === 'registry-1.docker.io' && !repository.includes('/')) {
      repository = `library/${repository}`;
    }

    return {
      registry,
      repository,
      tag,
      fullName: `${registry}/${repository}:${tag}`
    };
  }

  async authenticate(repository: string): Promise<void> {
    try {
      // Try anonymous access first
      const authUrl = `${this.protocol}://${this.registry}/v2/`;
      const response = await this.loggedGet(authUrl, { validateStatus: () => true });

      if (response.status === 401) {
        const wwwAuth = response.headers['www-authenticate'];
        if (!wwwAuth) throw new Error('No authentication challenge received');

        // Parse WWW-Authenticate header
        const match = wwwAuth.match(/Bearer realm="([^"]+)"(?:,service="([^"]+)")?(?:,scope="([^"]+)")?/);
        if (!match) throw new Error('Invalid authentication challenge');

        const [, realm, service, scope] = match;
        
        // Request token
        const tokenUrl = new URL(realm);
        if (service) tokenUrl.searchParams.set('service', service);
        tokenUrl.searchParams.set('scope', scope || `repository:${repository}:pull`);

        const tokenResponse = await this.loggedGet(tokenUrl.toString(), {
          ...(this.credential && { auth: { username: this.credential.username, password: this.credential.password } })
        });

        this.token = tokenResponse.data?.token || tokenResponse.data?.access_token;
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error(`Authentication failed for ${this.registry}. Please check credentials.`);
      }
      throw error;
    }
  }

  async getManifest(imageRef: string): Promise<Manifest> {
    const ref = this.parseImageReference(imageRef);
    await this.authenticate(ref.repository);

    const url = `${this.protocol}://${ref.registry}/v2/${ref.repository}/manifests/${ref.tag}`;
    const headers: any = {
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await this.loggedGet(url, { headers });
    const manifest = response.data;
    
    // Handle manifest lists (multi-platform images)
    if (manifest.mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json' ||
        manifest.mediaType === 'application/vnd.oci.image.index.v1+json') {
      // Get the first platform-specific manifest (usually linux/amd64)
      const platformManifest = manifest.manifests?.[0];
      if (!platformManifest) {
        throw new Error('No platform manifests found in manifest list');
      }
      
      // Fetch the actual image manifest
      const platformUrl = `${this.protocol}://${ref.registry}/v2/${ref.repository}/manifests/${platformManifest.digest}`;
      const platformResponse = await this.loggedGet(platformUrl, { headers });
      return platformResponse.data;
    }
    
    return manifest;
  }

  async getBlob(imageRef: string, digest: string): Promise<Buffer> {
    const ref = this.parseImageReference(imageRef);
    const url = `${this.protocol}://${ref.registry}/v2/${ref.repository}/blobs/${digest}`;
    
    const headers: any = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await this.loggedGet(url, {
      headers,
      responseType: 'arraybuffer'
    });

    return Buffer.from(response.data);
  }

  async getConfig(imageRef: string): Promise<any> {
    const manifest = await this.getManifest(imageRef);
    const configBlob = await this.getBlob(imageRef, manifest.config.digest);
    return JSON.parse(configBlob.toString());
  }

  async downloadLayer(imageRef: string, digest: string, onProgress?: (progress: number) => void): Promise<Buffer> {
    const ref = this.parseImageReference(imageRef);
    const url = `${this.protocol}://${ref.registry}/v2/${ref.repository}/blobs/${digest}`;
    
    const headers: any = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await this.loggedGet(url, {
      headers,
      responseType: 'arraybuffer',
      onDownloadProgress: (progressEvent: any) => {
        if (onProgress && progressEvent.total) {
          const progress = (progressEvent.loaded / progressEvent.total) * 100;
          onProgress(progress);
        }
      }
    });

    return Buffer.from(response.data);
  }
}
