import { chromium, firefox, webkit, Browser, Page, BrowserContext } from 'playwright';

// 簡化的日誌接口
interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

// 創建簡單的日誌器
const createSimpleLogger = (name: string): Logger => ({
  info: (message: string, ...args: any[]) => console.log(`[${name}] INFO:`, message, ...args),
  warn: (message: string, ...args: any[]) => console.warn(`[${name}] WARN:`, message, ...args),
  error: (message: string, ...args: any[]) => console.error(`[${name}] ERROR:`, message, ...args)
});

const logger = createSimpleLogger('stealth-browser');

// 簡單的重試函數
async function simpleRetry<T>(
  fn: () => Promise<T>, 
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < retries) {
        logger.warn(`重試 ${i + 1}/${retries}: ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
  
  throw lastError!;
}

// 簡單的速率限制
class SimpleRateLimit {
  private lastCall: number = 0;
  
  constructor(private intervalMs: number) {}
  
  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;
    
    if (timeSinceLastCall < this.intervalMs) {
      const waitTime = this.intervalMs - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastCall = Date.now();
  }
}

export interface StealthBrowserOptions {
  headless?: boolean;
  timeout?: number;
  userAgent?: string;
  proxy?: string;
  viewport?: { width: number; height: number };
  blockedResourceTypes?: string[];
  enableStealth?: boolean;
  browserType?: 'chromium' | 'firefox' | 'webkit';
}

export class StealthBrowser {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private options: StealthBrowserOptions;
  private rateLimit: SimpleRateLimit;

  constructor(options: StealthBrowserOptions = {}) {
    this.options = {
      headless: true,
      timeout: 30000,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      blockedResourceTypes: ['image', 'font', 'media'],
      enableStealth: true,
      browserType: 'chromium',
      ...options
    };
    
    this.rateLimit = new SimpleRateLimit(1000); // 1秒間隔
  }

  async initialize(): Promise<void> {
    try {
      logger.info('正在初始化隱身瀏覽器...');
      
      const launchOptions: any = {
        headless: this.options.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=VizDisplayCompositor'
        ]
      };

      // 添加代理設定
      if (this.options.proxy) {
        launchOptions.proxy = {
          server: this.options.proxy
        };
      }

      // 選擇瀏覽器類型
      switch (this.options.browserType) {
        case 'firefox':
          this.browser = await firefox.launch(launchOptions);
          break;
        case 'webkit':
          this.browser = await webkit.launch(launchOptions);
          break;
        default:
          this.browser = await chromium.launch(launchOptions);
      }

      // 創建上下文
      this.context = await this.browser.newContext({
        userAgent: this.options.userAgent,
        viewport: this.options.viewport,
        extraHTTPHeaders: {
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      // 設定隱身配置
      if (this.options.enableStealth) {
        await this.applyStealth();
      }

      this.page = await this.context.newPage();

      // 設定資源攔截
      if (this.options.blockedResourceTypes && this.options.blockedResourceTypes.length > 0) {
        await this.page.route('**/*', (route) => {
          if (this.options.blockedResourceTypes!.includes(route.request().resourceType())) {
            route.abort();
          } else {
            route.continue();
          }
        });
      }

      // 設定超時
      this.page.setDefaultTimeout(this.options.timeout!);
      
      logger.info('隱身瀏覽器初始化完成');
    } catch (error) {
      logger.error('隱身瀏覽器初始化失敗:', error);
      throw error;
    }
  }

  private async applyStealth(): Promise<void> {
    if (!this.context) return;

    // 添加反偵測腳本
    await this.context.addInitScript(() => {
      // 移除 webdriver 標識
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // 隱藏自動化控制特徵
      delete (window as any).chrome?.runtime?.onConnect;
      delete (window as any).chrome?.runtime?.onMessage;

      // 偽造插件
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', description: 'Portable Document Format' },
          { name: 'Native Client', description: 'Native Client' }
        ],
      });

      // 偽造語言
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-TW', 'zh', 'en'],
      });

      // 偽造硬體併發
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 4,
      });

      // 偽造記憶體
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
      });
    });
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) {
      throw new Error('瀏覽器未初始化');
    }

    // 應用速率限制
    await this.rateLimit.wait();

    await simpleRetry(
      async () => {
        logger.info(`正在導航到: ${url}`);
        await this.page!.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: this.options.timeout
        });

        // 等待頁面完全載入
        await this.page!.waitForTimeout(2000);
        
        // 模擬人類行為
        await this.simulateHumanBehavior();
        
        logger.info(`成功導航到: ${url}`);
      },
      3,
      1000
    );
  }

  private async simulateHumanBehavior(): Promise<void> {
    if (!this.page) return;

    // 隨機滑鼠移動
    await this.page.mouse.move(
      Math.random() * this.options.viewport!.width,
      Math.random() * this.options.viewport!.height,
      { steps: 10 }
    );

    // 隨機滾動
    await this.page.evaluate(() => {
      window.scrollTo(0, Math.random() * document.body.scrollHeight * 0.3);
    });

    // 隨機等待
    await this.page.waitForTimeout(500 + Math.random() * 2000);
  }

  async getContent(): Promise<{ title: string; content: string; url: string }> {
    if (!this.page) {
      throw new Error('瀏覽器未初始化');
    }

    const title = await this.page.title();
    const content = await this.page.content();
    const url = this.page.url();

    return { title, content, url };
  }

  async executeScript(script: string): Promise<any> {
    if (!this.page) {
      throw new Error('瀏覽器未初始化');
    }

    return await this.page.evaluate(script);
  }

  async screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Buffer> {
    if (!this.page) {
      throw new Error('瀏覽器未初始化');
    }

    return await this.page.screenshot({
      fullPage: options?.fullPage ?? true,
      path: options?.path
    });
  }

  async close(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      logger.info('隱身瀏覽器已關閉');
    } catch (error) {
      logger.error('關閉隱身瀏覽器時發生錯誤:', error);
    }
  }
} 