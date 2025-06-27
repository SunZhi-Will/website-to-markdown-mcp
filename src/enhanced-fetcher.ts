import axios from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

// 錯誤重試配置
interface RetryOptions {
  maxRetries: number;
  delay: number;
  backoffFactor: number;
}

// 內容處理選項
interface ContentOptions {
  removeAds?: boolean;
  removeNavigation?: boolean;
  extractMainContent?: boolean;
  timeout?: number;
  userAgent?: string;
}

// 處理結果接口
interface ProcessedContent {
  title: string;
  content: string;
  markdown: string;
  wordCount: number;
  readingTime: number;
  summary?: string;
  language: string;
}

export class EnhancedWebsiteFetcher {
  private turndownService: TurndownService;
  private defaultOptions: ContentOptions;

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      fence: '```',
      emDelimiter: '*',
      strongDelimiter: '**'
    });

    this.setupTurndownRules();

    this.defaultOptions = {
      removeAds: true,
      removeNavigation: true,
      extractMainContent: true,
      timeout: 30000,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
  }

  private setupTurndownRules(): void {
    // 處理刪除線
    this.turndownService.addRule('strikethrough', {
      filter: ['del', 's'],
      replacement: (content) => `~~${content}~~`
    });

    // 處理下劃線
    this.turndownService.addRule('underline', {
      filter: 'u',
      replacement: (content) => `<u>${content}</u>`
    });

    // 處理高亮
    this.turndownService.addRule('mark', {
      filter: 'mark',
      replacement: (content) => `==${content}==`
    });

    // 處理鍵盤輸入
    this.turndownService.addRule('keyboard', {
      filter: 'kbd',
      replacement: (content) => `\`${content}\``
    });
  }

  // 帶重試的網路請求
  private async fetchWithRetry(url: string, options: ContentOptions, retryOptions: RetryOptions): Promise<string> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
      try {
        console.error(`正在獲取 ${url} (嘗試 ${attempt + 1}/${retryOptions.maxRetries + 1})`);
        
        const response = await axios.get(url, {
          timeout: options.timeout,
          headers: {
            'User-Agent': options.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          },
          maxRedirects: 5,
          validateStatus: (status) => status < 400
        });

        return response.data;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < retryOptions.maxRetries) {
          const delay = retryOptions.delay * Math.pow(retryOptions.backoffFactor, attempt);
          console.error(`請求失敗，${delay}ms 後重試: ${lastError.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw new Error(`所有重試都失敗了: ${lastError!.message}`);
  }

  // 清理和提取內容
  private cleanAndExtractContent($: cheerio.CheerioAPI, options: ContentOptions): { content: string; title: string } {
    // 移除不需要的元素
    $('script, style, noscript').remove();
    
    if (options.removeAds) {
      this.removeAds($);
    }
    
    if (options.removeNavigation) {
      $('nav, .nav, .navbar, .navigation, .menu, header, .header').remove();
      $('footer, .footer, .site-footer').remove();
      $('aside, .sidebar, .side-bar').remove();
    }
    
    // 提取標題
    const title = this.extractTitle($);
    
    // 提取主要內容
    let content: string;
    if (options.extractMainContent) {
      content = this.extractMainContent($);
    } else {
      content = $('body').html() || '';
    }
    
    return { content, title };
  }

  private removeAds($: cheerio.CheerioAPI): void {
    const adSelectors = [
      '[class*="ad"]', '[id*="ad"]',
      '[class*="ads"]', '[id*="ads"]',
      '[class*="advertisement"]', '[id*="advertisement"]',
      '[class*="sponsor"]', '[id*="sponsor"]',
      '[class*="banner"]', '[id*="banner"]',
      '[class*="popup"]', '[id*="popup"]',
      '.google-ad', '.adsystem', '.adsbygoogle'
    ];
    
    adSelectors.forEach(selector => {
      $(selector).remove();
    });
  }

  private extractTitle($: cheerio.CheerioAPI): string {
    const titleSources = [
      'h1',
      '.title',
      '.post-title',
      '.article-title',
      '.entry-title',
      '[property="og:title"]',
      'title'
    ];
    
    for (const source of titleSources) {
      const title = $(source).first().text().trim() || 
                   $(source).first().attr('content')?.trim();
      if (title && title.length > 0) {
        return title;
      }
    }
    
    return 'Untitled';
  }

  private extractMainContent($: cheerio.CheerioAPI): string {
    const contentSelectors = [
      'main', '[role="main"]', '.main', '.content', '.post-content',
      '.article-content', '.entry-content', '.post-body', '.article-body',
      'article', '.article', '.post', '.blog-post'
    ];
    
    for (const selector of contentSelectors) {
      const content = $(selector).first();
      if (content.length && content.text().trim().length > 100) {
        return content.html() || '';
      }
    }
    
    // 如果找不到主要內容，使用啟發式方法
    return this.heuristicContentExtraction($);
  }

  private heuristicContentExtraction($: cheerio.CheerioAPI): string {
    let bestElement = '';
    let maxScore = 0;
    
    $('div, article, section').each((_, element) => {
      const $el = $(element);
      const textLength = $el.text().trim().length;
      const linkDensity = this.calculateLinkDensity($el);
      const paragraphCount = $el.find('p').length;
      
      // 計算內容分數
      let score = textLength * 0.3 + paragraphCount * 10;
      score -= linkDensity * textLength * 0.2; // 懲罰高連結密度
      score -= $el.find('script, style, nav, aside, footer').length * 50;
      
      if (score > maxScore) {
        maxScore = score;
        bestElement = $el.html() || '';
      }
    });
    
    return bestElement || $('body').html() || '';
  }

  private calculateLinkDensity($el: cheerio.Cheerio<any>): number {
    const totalText = $el.text().trim().length;
    const linkText = $el.find('a').text().trim().length;
    return totalText > 0 ? linkText / totalText : 0;
  }

  // 後處理 Markdown
  private postProcessMarkdown(markdown: string): string {
    let processed = markdown;
    
    // 清理多餘的空行
    processed = processed.replace(/\n{3,}/g, '\n\n');
    
    // 修復列表格式
    processed = processed.replace(/^[\s]*[\*\-\+][\s]/gm, '- ');
    processed = processed.replace(/^[\s]*\d+\.[\s]/gm, (match) => {
      const num = match.match(/\d+/)?.[0] || '1';
      return `${num}. `;
    });
    
    // 改善連結格式
    processed = processed.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (match, text, url) => {
      if (!text.trim()) return url;
      return `[${text.trim()}](${url})`;
    });
    
    return processed.trim();
  }

  // 計算字數
  private countWords(text: string): number {
    // 支持中文和英文的字數統計
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = text
      .replace(/[\u4e00-\u9fff]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 0).length;
    
    return chineseChars + englishWords;
  }

  // 計算閱讀時間
  private calculateReadingTime(wordCount: number): number {
    const averageReadingSpeed = 225; // 每分鐘字數
    return Math.ceil(wordCount / averageReadingSpeed);
  }

  // 生成摘要
  private generateSummary(text: string, maxLength: number = 200): string {
    const sentences = text.split(/[.!?。！？]/).filter(s => s.trim().length > 10);
    
    if (sentences.length === 0) return '';
    
    let summary = '';
    for (const sentence of sentences) {
      if (summary.length + sentence.length > maxLength) break;
      summary += sentence.trim() + '。';
    }
    
    return summary || sentences[0]?.substring(0, maxLength) + '...';
  }

  // 檢測語言
  private detectLanguage(text: string): string {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const totalChars = text.replace(/\s/g, '').length;
    
    if (chineseChars / totalChars > 0.3) {
      return 'zh';
    }
    
    return 'en';
  }

  // 主要公共方法
  async fetchAndProcess(url: string, options: Partial<ContentOptions> = {}): Promise<ProcessedContent> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    const retryOptions: RetryOptions = {
      maxRetries: 3,
      delay: 1000,
      backoffFactor: 2
    };

    try {
      const startTime = Date.now();
      
      // 獲取原始內容
      const html = await this.fetchWithRetry(url, mergedOptions, retryOptions);
      
      // 解析和清理
      const $ = cheerio.load(html);
      const { content, title } = this.cleanAndExtractContent($, mergedOptions);
      
      // 轉換為 Markdown
      const rawMarkdown = this.turndownService.turndown(content);
      const markdown = this.postProcessMarkdown(rawMarkdown);
      
      // 計算統計信息
      const wordCount = this.countWords(markdown);
      const readingTime = this.calculateReadingTime(wordCount);
      const summary = this.generateSummary(markdown);
      const language = this.detectLanguage(markdown);
      
      const duration = Date.now() - startTime;
      console.error(`成功處理 ${url}，用時 ${duration}ms，字數 ${wordCount}`);
      
      return {
        title,
        content,
        markdown,
        wordCount,
        readingTime,
        summary,
        language
      };
      
    } catch (error) {
      console.error(`處理 ${url} 時發生錯誤:`, error);
      throw error;
    }
  }
} 