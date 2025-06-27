import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, watchFile } from 'fs';
import { join } from 'path';

// 網站配置結構
const WebsiteSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  customSettings: z.object({
    timeout: z.number().min(1000).max(120000).optional(),
    retries: z.number().min(0).max(10).optional(),
    useStealthBrowser: z.boolean().optional(),
    extractMainContent: z.boolean().optional(),
    removeAds: z.boolean().optional(),
    preserveImages: z.boolean().optional(),
    preserveLinks: z.boolean().optional(),
    customUserAgent: z.string().optional(),
    customHeaders: z.record(z.string()).optional(),
    rateLimit: z.object({
      requestsPerSecond: z.number().min(0.1).max(100).optional(),
      burstLimit: z.number().min(1).max(1000).optional()
    }).optional()
  }).optional()
});

// 全域設定結構
const GlobalSettingsSchema = z.object({
  defaultTimeout: z.number().min(1000).max(120000).default(30000),
  defaultRetries: z.number().min(0).max(10).default(3),
  defaultUserAgent: z.string().default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'),
  maxConcurrentRequests: z.number().min(1).max(50).default(5),
  enableGlobalRateLimit: z.boolean().default(true),
  globalRateLimit: z.object({
    requestsPerSecond: z.number().min(0.1).max(100).default(2),
    burstLimit: z.number().min(1).max(1000).default(10)
  }),
  stealthBrowser: z.object({
    enabled: z.boolean().default(false),
    headless: z.boolean().default(true),
    blockResources: z.array(z.string()).default(['image', 'font', 'media']),
    useProxy: z.boolean().default(false),
    proxyUrl: z.string().optional()
  }),
  contentProcessing: z.object({
    removeAds: z.boolean().default(true),
    removeNavigation: z.boolean().default(true),
    removeFooter: z.boolean().default(true),
    removeSidebar: z.boolean().default(true),
    extractMainContent: z.boolean().default(true),
    preserveImages: z.boolean().default(false),
    preserveLinks: z.boolean().default(true),
    minTextLength: z.number().min(0).default(100),
    maxTextLength: z.number().min(1000).optional(),
    generateSummary: z.boolean().default(true)
  }),
  caching: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().min(60).max(86400).default(3600), // 1 hour
    maxSize: z.number().min(10).max(10000).default(1000), // max cached items
    useRedis: z.boolean().default(false),
    redisUrl: z.string().optional()
  }),
  logging: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    enableFileLogging: z.boolean().default(true),
    enablePerformanceLogging: z.boolean().default(true),
    logDirectory: z.string().default('./logs')
  }),
  monitoring: z.object({
    enabled: z.boolean().default(true),
    metricsPort: z.number().min(1000).max(65535).optional(),
    healthCheckInterval: z.number().min(1000).max(300000).default(30000)
  })
});

// 主配置結構
const ConfigSchema = z.object({
  websites: z.array(WebsiteSchema),
  settings: GlobalSettingsSchema.optional()
});

export type Website = z.infer<typeof WebsiteSchema>;
export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export class ConfigManager {
  private config: Config;
  private configPath: string;
  private watchers: Set<(config: Config) => void> = new Set();
  private isWatching: boolean = false;

  constructor(configPath?: string) {
    this.configPath = configPath || join(process.cwd(), 'config.json');
    this.config = this.loadConfig();
    this.setupFileWatcher();
  }

  private loadConfig(): Config {
    if (!existsSync(this.configPath)) {
      console.warn(`配置文件不存在: ${this.configPath}，使用默認配置`);
      return this.getDefaultConfig();
    }

    try {
      const rawConfig = readFileSync(this.configPath, 'utf-8');
      const parsedConfig = JSON.parse(rawConfig);
      
      // 驗證配置
      const validatedConfig = ConfigSchema.parse(parsedConfig);
      
      // 合併默認設定
      const defaultSettings = GlobalSettingsSchema.parse({});
      validatedConfig.settings = {
        ...defaultSettings,
        ...validatedConfig.settings
      };

      console.log(`成功載入配置文件: ${this.configPath}`);
      return validatedConfig;
    } catch (error) {
      console.error(`載入配置文件失敗: ${error instanceof Error ? error.message : String(error)}`);
      console.log('使用默認配置');
      return this.getDefaultConfig();
    }
  }

  private getDefaultConfig(): Config {
    return {
      websites: [
        {
          name: 'example',
          url: 'https://example.com',
          description: 'Example website',
          enabled: true
        }
      ],
      settings: GlobalSettingsSchema.parse({})
    };
  }

  private setupFileWatcher(): void {
    if (this.isWatching) return;

    if (existsSync(this.configPath)) {
      watchFile(this.configPath, (curr, prev) => {
        if (curr.mtime > prev.mtime) {
          console.log('檢測到配置文件變更，正在重新載入...');
          try {
            const newConfig = this.loadConfig();
            this.config = newConfig;
            this.notifyWatchers(newConfig);
            console.log('配置文件重新載入成功');
          } catch (error) {
            console.error('配置文件重新載入失敗:', error);
          }
        }
      });
      this.isWatching = true;
    }
  }

  private notifyWatchers(config: Config): void {
    this.watchers.forEach(callback => {
      try {
        callback(config);
      } catch (error) {
        console.error('配置更新回調執行失敗:', error);
      }
    });
  }

  // 公共方法
  getConfig(): Config {
    return this.config;
  }

  getWebsites(): Website[] {
    return this.config.websites.filter(site => site.enabled);
  }

  getWebsiteByName(name: string): Website | undefined {
    return this.config.websites.find(site => site.name === name && site.enabled);
  }

  getGlobalSettings(): GlobalSettings {
    return this.config.settings || GlobalSettingsSchema.parse({});
  }

  addWebsite(website: Omit<Website, 'enabled'>): void {
    const newWebsite: Website = {
      ...website,
      enabled: true
    };

    try {
      WebsiteSchema.parse(newWebsite);
      this.config.websites.push(newWebsite);
      this.saveConfig();
      console.log(`成功添加網站: ${website.name}`);
    } catch (error) {
      throw new Error(`添加網站失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  updateWebsite(name: string, updates: Partial<Website>): void {
    const index = this.config.websites.findIndex(site => site.name === name);
    if (index === -1) {
      throw new Error(`網站不存在: ${name}`);
    }

    const updatedWebsite = { ...this.config.websites[index], ...updates };
    
    try {
      WebsiteSchema.parse(updatedWebsite);
      this.config.websites[index] = updatedWebsite;
      this.saveConfig();
      console.log(`成功更新網站: ${name}`);
    } catch (error) {
      throw new Error(`更新網站失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  removeWebsite(name: string): void {
    const index = this.config.websites.findIndex(site => site.name === name);
    if (index === -1) {
      throw new Error(`網站不存在: ${name}`);
    }

    this.config.websites.splice(index, 1);
    this.saveConfig();
    console.log(`成功移除網站: ${name}`);
  }

  toggleWebsite(name: string): void {
    const website = this.config.websites.find(site => site.name === name);
    if (!website) {
      throw new Error(`網站不存在: ${name}`);
    }

    website.enabled = !website.enabled;
    this.saveConfig();
    console.log(`網站 ${name} 已${website.enabled ? '啟用' : '停用'}`);
  }

  updateGlobalSettings(settings: Partial<GlobalSettings>): void {
    const currentSettings = this.getGlobalSettings();
    const newSettings = { ...currentSettings, ...settings };

    try {
      GlobalSettingsSchema.parse(newSettings);
      this.config.settings = newSettings;
      this.saveConfig();
      console.log('全域設定更新成功');
    } catch (error) {
      throw new Error(`更新全域設定失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private saveConfig(): void {
    try {
      const configData = JSON.stringify(this.config, null, 2);
      writeFileSync(this.configPath, configData, 'utf-8');
      this.notifyWatchers(this.config);
    } catch (error) {
      throw new Error(`保存配置文件失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 配置驗證
  validateConfig(): { isValid: boolean; errors: string[] } {
    try {
      ConfigSchema.parse(this.config);
      return { isValid: true, errors: [] };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
        return { isValid: false, errors };
      }
      return { isValid: false, errors: [String(error)] };
    }
  }

  // 配置統計
  getStats(): {
    totalWebsites: number;
    enabledWebsites: number;
    disabledWebsites: number;
    configSize: number;
    lastModified?: Date;
  } {
    const stats = {
      totalWebsites: this.config.websites.length,
      enabledWebsites: this.config.websites.filter(site => site.enabled).length,
      disabledWebsites: this.config.websites.filter(site => !site.enabled).length,
      configSize: JSON.stringify(this.config).length,
      lastModified: undefined as Date | undefined
    };

    if (existsSync(this.configPath)) {
      const stat = require('fs').statSync(this.configPath);
      stats.lastModified = stat.mtime;
    }

    return stats;
  }

  // 監聽配置變更
  onConfigChange(callback: (config: Config) => void): () => void {
    this.watchers.add(callback);
    
    // 返回取消監聽的函數
    return () => {
      this.watchers.delete(callback);
    };
  }

  // 導出配置
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  // 導入配置
  importConfig(configData: string): void {
    try {
      const parsedConfig = JSON.parse(configData);
      const validatedConfig = ConfigSchema.parse(parsedConfig);
      
      this.config = validatedConfig;
      this.saveConfig();
      console.log('配置導入成功');
    } catch (error) {
      throw new Error(`導入配置失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 重置為默認配置
  resetToDefault(): void {
    this.config = this.getDefaultConfig();
    this.saveConfig();
    console.log('配置已重置為默認值');
  }

  // 獲取網站的合併設定（全域設定 + 網站自訂設定）
  getMergedSettingsForWebsite(websiteName: string): GlobalSettings & Website['customSettings'] {
    const website = this.getWebsiteByName(websiteName);
    const globalSettings = this.getGlobalSettings();
    
    if (!website) {
      return globalSettings;
    }

    return {
      ...globalSettings,
      ...website.customSettings,
      timeout: website.customSettings?.timeout || globalSettings.defaultTimeout,
      retries: website.customSettings?.retries || globalSettings.defaultRetries
    };
  }
}

// 單例模式的全域配置管理器
let globalConfigManager: ConfigManager | null = null;

export function getConfigManager(configPath?: string): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new ConfigManager(configPath);
  }
  return globalConfigManager;
}

// 便利函數
export function getConfig(): Config {
  return getConfigManager().getConfig();
}

export function getGlobalSettings(): GlobalSettings {
  return getConfigManager().getGlobalSettings();
}

export function getWebsites(): Website[] {
  return getConfigManager().getWebsites();
} 