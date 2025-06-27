// 簡單的速率限制器實作，不依賴外部包
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    const tokensToAdd = Math.floor(timePassed * this.refillRate);
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  async consume(tokens: number = 1): Promise<void> {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }
    
    // 計算需要等待的時間
    const tokensNeeded = tokens - this.tokens;
    const waitTime = (tokensNeeded / this.refillRate) * 1000;
    
    await new Promise(resolve => setTimeout(resolve, waitTime));
    await this.consume(tokens);
  }

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

// 全域速率限制器實例
const globalRateLimiter = new RateLimiter(10, 1); // 每秒最多10個請求

// 簡單的並發限制器
export class ConcurrencyLimiter {
  private activeCount: number = 0;
  private pendingQueue: Array<() => void> = [];

  constructor(private maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.activeCount++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeCount--;
          this.processQueue();
        }
      };

      if (this.activeCount < this.maxConcurrency) {
        execute();
      } else {
        this.pendingQueue.push(execute);
      }
    });
  }

  private processQueue(): void {
    if (this.pendingQueue.length > 0 && this.activeCount < this.maxConcurrency) {
      const next = this.pendingQueue.shift();
      if (next) {
        next();
      }
    }
  }

  get active(): number {
    return this.activeCount;
  }

  get pending(): number {
    return this.pendingQueue.length;
  }

  clearQueue(): void {
    this.pendingQueue = [];
  }
}

// 全域並發限制器
const globalConcurrencyLimiter = new ConcurrencyLimiter(5); // 最多5個並發請求

// 組合速率限制和並發控制的函數
export async function throttledRequest<T>(
  fn: () => Promise<T>,
  options: {
    rateLimiter?: RateLimiter;
    concurrencyLimiter?: ConcurrencyLimiter;
  } = {}
): Promise<T> {
  const {
    rateLimiter = globalRateLimiter,
    concurrencyLimiter = globalConcurrencyLimiter
  } = options;

  // 先消耗速率限制令牌
  await rateLimiter.consume(1);
  
  // 然後在並發限制下執行
  return concurrencyLimiter.run(fn);
}

// 智能速率限制器 - 根據錯誤狀態自動調整
export class AdaptiveRateLimiter {
  private baseLimiter: RateLimiter;
  private errorCount: number = 0;
  private successCount: number = 0;
  private lastErrorTime: number = 0;
  private adaptationWindow: number = 60000; // 1分鐘

  constructor(
    private baseRate: number,
    private maxTokens: number = baseRate * 2,
    private errorThreshold: number = 3
  ) {
    this.baseLimiter = new RateLimiter(maxTokens, baseRate);
  }

  async consume(): Promise<void> {
    // 檢查是否需要調整速率
    this.adjustRate();
    
    await this.baseLimiter.consume(1);
  }

  onSuccess(): void {
    this.successCount++;
    this.errorCount = Math.max(0, this.errorCount - 0.1); // 緩慢恢復
  }

  onError(): void {
    this.errorCount++;
    this.lastErrorTime = Date.now();
    this.successCount = Math.max(0, this.successCount - 1);
  }

  private adjustRate(): void {
    const now = Date.now();
    const timeSinceLastError = now - this.lastErrorTime;
    
    if (this.errorCount >= this.errorThreshold) {
      // 如果錯誤過多，降低速率
      const slowdownFactor = Math.min(0.1, 1 / (this.errorCount - this.errorThreshold + 1));
      const newRate = this.baseRate * slowdownFactor;
      this.baseLimiter = new RateLimiter(this.maxTokens, newRate);
    } else if (timeSinceLastError > this.adaptationWindow && this.successCount > 10) {
      // 如果長時間沒有錯誤且成功率高，逐漸恢復到基準速率
      const recoveryFactor = Math.min(1, this.successCount / 20);
      const newRate = this.baseRate * recoveryFactor;
      this.baseLimiter = new RateLimiter(this.maxTokens, newRate);
    }
  }

  getStats(): {
    errorCount: number;
    successCount: number;
    currentRate: number;
    availableTokens: number;
  } {
    return {
      errorCount: this.errorCount,
      successCount: this.successCount,
      currentRate: (this.baseLimiter as any).refillRate,
      availableTokens: this.baseLimiter.getAvailableTokens()
    };
  }
}

// 全域的調用時間記錄
const _lastCalls = new Map<string, number>();

// 簡單的速率限制函數
export async function rateLimit(intervalMs: number = 1000): Promise<void> {
  const key = 'global';
  const now = Date.now();
  
  const lastCall = _lastCalls.get(key) || 0;
  const timeSinceLastCall = now - lastCall;
  
  if (timeSinceLastCall < intervalMs) {
    const waitTime = intervalMs - timeSinceLastCall;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  _lastCalls.set(key, Date.now());
}

// 導出便利函數
export { globalRateLimiter, globalConcurrencyLimiter }; 