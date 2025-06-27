import winston from 'winston';
import { join } from 'path';

// 創建日誌格式
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, service, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `[${timestamp}] ${level.toUpperCase()} [${service || 'main'}]: ${message}${metaStr}${stackStr}`;
  })
);

// 創建主要日誌實例
const mainLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'website-to-markdown-mcp' },
  transports: [
    // 控制台輸出
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    // 錯誤日誌文件
    new winston.transports.File({
      filename: join(process.cwd(), 'logs', 'error.log'),
      level: 'error'
    }),
    // 完整日誌文件
    new winston.transports.File({
      filename: join(process.cwd(), 'logs', 'combined.log')
    })
  ],
  // 處理未捕獲的異常
  exceptionHandlers: [
    new winston.transports.File({ filename: join(process.cwd(), 'logs', 'exceptions.log') })
  ],
  // 處理未捕獲的 Promise 拒絕
  rejectionHandlers: [
    new winston.transports.File({ filename: join(process.cwd(), 'logs', 'rejections.log') })
  ]
});

// 生產環境不輸出到控制台
if (process.env.NODE_ENV === 'production') {
  mainLogger.remove(mainLogger.transports[0]);
}

// 創建帶有服務名稱的日誌器
export function createLogger(service: string): winston.Logger {
  return mainLogger.child({ service });
}

// 默認導出主日誌器
export default mainLogger;

// 性能監控日誌器
export const performanceLogger = createLogger('performance');

// 安全相關日誌器
export const securityLogger = createLogger('security');

// 審計日誌器
export const auditLogger = createLogger('audit');

// 輔助函數：記錄函數執行時間
export function logExecutionTime<T extends (...args: any[]) => any>(
  fn: T,
  logger: winston.Logger,
  functionName?: string
): T {
  return ((...args: Parameters<T>): ReturnType<T> => {
    const start = Date.now();
    const name = functionName || fn.name || 'anonymous';
    
    try {
      const result = fn(...args);
      
      // 如果是 Promise，等待完成後記錄
      if (result && typeof result.then === 'function') {
        return result
          .then((value: any) => {
            const duration = Date.now() - start;
            performanceLogger.info(`函數 ${name} 執行完成`, { duration, args: args.slice(0, 2) });
            return value;
          })
          .catch((error: any) => {
            const duration = Date.now() - start;
            performanceLogger.error(`函數 ${name} 執行失敗`, { duration, error: error.message, args: args.slice(0, 2) });
            throw error;
          });
      } else {
        // 同步函數
        const duration = Date.now() - start;
        performanceLogger.info(`函數 ${name} 執行完成`, { duration, args: args.slice(0, 2) });
        return result;
      }
    } catch (error: any) {
      const duration = Date.now() - start;
      performanceLogger.error(`函數 ${name} 執行失敗`, { duration, error: error.message, args: args.slice(0, 2) });
      throw error;
    }
  }) as T;
} 