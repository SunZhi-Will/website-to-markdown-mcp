export interface RetryOptions {
  retries: number;
  factor: number;
  minTimeout: number;
  maxTimeout: number;
  randomize?: boolean;
  onRetry?: (error: Error, attempt: number) => void;
}

export class RetryError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(message: string, attempts: number, lastError: Error) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { retries, factor, minTimeout, maxTimeout, randomize = false, onRetry } = options;
  
  let lastError: Error;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // 如果是最後一次嘗試，直接拋出錯誤
      if (attempt === retries) {
        throw new RetryError(
          `操作失敗，已重試 ${retries} 次: ${lastError.message}`,
          attempt + 1,
          lastError
        );
      }
      
      // 調用重試回調
      if (onRetry) {
        onRetry(lastError, attempt + 1);
      }
      
      // 計算延遲時間
      let delay = Math.min(minTimeout * Math.pow(factor, attempt), maxTimeout);
      
      if (randomize) {
        delay = delay * (Math.random() + 0.5); // 0.5x 到 1.5x 的隨機化
      }
      
      // 等待延遲
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // 這行不應該被執行到，但為了 TypeScript 的類型檢查
  throw lastError!;
}

// 裝飾器版本的重試功能
export function retryMethod(options: RetryOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      return retry(() => originalMethod.apply(this, args), options);
    };
    
    return descriptor;
  };
}

// 特定錯誤類型的重試
export async function retryOnError<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  retryableErrors: (string | RegExp)[]
): Promise<T> {
  const isRetryableError = (error: Error): boolean => {
    return retryableErrors.some(pattern => {
      if (typeof pattern === 'string') {
        return error.message.includes(pattern) || error.name === pattern;
      } else {
        return pattern.test(error.message) || pattern.test(error.name);
      }
    });
  };
  
  let lastError: Error;
  
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // 如果不是可重試的錯誤，直接拋出
      if (!isRetryableError(lastError)) {
        throw lastError;
      }
      
      // 如果是最後一次嘗試，拋出重試錯誤
      if (attempt === options.retries) {
        throw new RetryError(
          `操作失敗，已重試 ${options.retries} 次: ${lastError.message}`,
          attempt + 1,
          lastError
        );
      }
      
      // 調用重試回調
      if (options.onRetry) {
        options.onRetry(lastError, attempt + 1);
      }
      
      // 計算延遲時間
      let delay = Math.min(
        options.minTimeout * Math.pow(options.factor, attempt),
        options.maxTimeout
      );
      
      if (options.randomize) {
        delay = delay * (Math.random() + 0.5);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// 指數退避重試（常用於網路請求）
export async function exponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  return retry(fn, {
    retries: maxRetries,
    factor: 2,
    minTimeout: baseDelay,
    maxTimeout: 30000,
    randomize: true
  });
} 