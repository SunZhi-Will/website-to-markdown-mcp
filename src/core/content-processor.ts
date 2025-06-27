import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

export interface ProcessingOptions {
  removeAds?: boolean;
  removeNavigation?: boolean;
  removeFooter?: boolean;
  removeSidebar?: boolean;
  extractMainContent?: boolean;
  preserveImages?: boolean;
  preserveLinks?: boolean;
  minTextLength?: number;
  maxTextLength?: number;
  language?: string;
}

export interface ProcessedContent {
  title: string;
  content: string;
  markdown: string;
  summary?: string;
  readingTime?: number;
  wordCount: number;
  language?: string;
  extractedImages?: string[];
  extractedLinks?: Array<{ text: string; url: string }>;
  metadata?: Record<string, any>;
}

export class ContentProcessor {
  private turndownService: TurndownService;
  
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

    // 配置 Turndown 規則
    this.setupTurndownRules();
  }

  private setupTurndownRules(): void {
    // 處理刪除線 - 修正類型錯誤
    this.turndownService.addRule('strikethrough', {
      filter: ['del', 's'],
      replacement: (content) => `~~${content}~~`
    });

    // 處理下劃線
    this.turndownService.addRule('underline', {
      filter: 'u',
      replacement: (content) => `<u>${content}</u>`
    });

    // 處理標記/高亮
    this.turndownService.addRule('mark', {
      filter: 'mark',
      replacement: (content) => `==${content}==`
    });

    // 處理鍵盤輸入
    this.turndownService.addRule('keyboard', {
      filter: 'kbd',
      replacement: (content) => `\`${content}\``
    });

    // 處理縮寫
    this.turndownService.addRule('abbreviation', {
      filter: 'abbr',
      replacement: (content, node: any) => {
        const title = node.getAttribute('title');
        return title ? `${content} (${title})` : content;
      }
    });

    // 處理定義列表
    this.turndownService.addRule('definitionList', {
      filter: ['dl', 'dt', 'dd'],
      replacement: (content, node: any) => {
        if (node.nodeName === 'DT') {
          return `**${content}**\n`;
        } else if (node.nodeName === 'DD') {
          return `: ${content}\n`;
        } else {
          return content;
        }
      }
    });

    // 處理表格增強
    this.turndownService.addRule('table', {
      filter: 'table',
      replacement: (content) => `\n${content}\n`
    });

    // 移除廣告和無用元素
    this.turndownService.addRule('removeAds', {
      filter: (node: any) => {
        const classList = node.className || '';
        const id = node.id || '';
        const adPatterns = [
          'ad', 'ads', 'advertisement', 'sponsor', 'banner',
          'popup', 'modal', 'overlay', 'promo', 'newsletter'
        ];
        
        return adPatterns.some(pattern => 
          classList.includes(pattern) || id.includes(pattern)
        );
      },
      replacement: () => ''
    });
  }

  async processContent(
    html: string,
    url: string,
    options: ProcessingOptions = {}
  ): Promise<ProcessedContent> {
    const $ = cheerio.load(html);
    
    // 清理和預處理
    this.cleanHTML($, options);
    
    // 提取基本資訊
    const title = this.extractTitle($);
    const cleanedHTML = $.html();
    
    // 提取元數據
    const metadata = this.extractMetadata($, url);
    
    // 提取圖片和連結
    const extractedImages = options.preserveImages ? this.extractImages($, url) : [];
    const extractedLinks = options.preserveLinks ? this.extractLinks($, url) : [];
    
    // 主要內容提取
    const mainContent = options.extractMainContent 
      ? this.extractMainContent($) 
      : $('body').html() || cleanedHTML;
    
    // 轉換為 Markdown
    const markdown = this.turndownService.turndown(mainContent);
    
    // 文本處理
    const processedMarkdown = this.postProcessMarkdown(markdown, options);
    
    // 計算統計信息
    const wordCount = this.countWords(processedMarkdown);
    const readingTime = this.calculateReadingTime(wordCount);
    
    // 生成摘要
    const summary = this.generateSummary(processedMarkdown);
    
    // 語言檢測
    const language = options.language || this.detectLanguage(processedMarkdown);

    return {
      title,
      content: mainContent,
      markdown: processedMarkdown,
      summary,
      readingTime,
      wordCount,
      language,
      extractedImages,
      extractedLinks,
      metadata
    };
  }

  private cleanHTML($: cheerio.CheerioAPI, options: ProcessingOptions): void {
    // 移除腳本和樣式
    $('script, style, noscript').remove();
    
    // 移除註釋
    $('*').contents().filter((_, node) => node.type === 'comment').remove();
    
    if (options.removeAds) {
      this.removeAds($);
    }
    
    if (options.removeNavigation) {
      $('nav, [role="navigation"], .nav, .navbar, .navigation, .menu').remove();
    }
    
    if (options.removeFooter) {
      $('footer, .footer, .site-footer, [role="contentinfo"]').remove();
    }
    
    if (options.removeSidebar) {
      $('aside, .sidebar, .side-bar, [role="complementary"]').remove();
    }
    
    // 移除隱藏元素
    $('[style*="display: none"], [style*="display:none"]').remove();
    $('[hidden], .hidden').remove();
    
    // 清理空元素
    $('*').filter((_, el) => {
      const $el = $(el);
      return $el.text().trim() === '' && 
             $el.find('img, video, audio, iframe, embed, object').length === 0;
    }).remove();
  }

  private removeAds($: cheerio.CheerioAPI): void {
    const adSelectors = [
      '[class*="ad"]', '[id*="ad"]',
      '[class*="ads"]', '[id*="ads"]',
      '[class*="advertisement"]', '[id*="advertisement"]',
      '[class*="sponsor"]', '[id*="sponsor"]',
      '[class*="banner"]', '[id*="banner"]',
      '[class*="popup"]', '[id*="popup"]',
      '.google-ad', '.adsystem', '.adsbygoogle',
      'iframe[src*="ads"]', 'iframe[src*="doubleclick"]'
    ];
    
    adSelectors.forEach(selector => {
      $(selector).remove();
    });
  }

  private extractMainContent($: cheerio.CheerioAPI): string {
    // 嘗試多種主要內容選擇器
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

  private extractTitle($: cheerio.CheerioAPI): string {
    // 嘗試多種標題來源
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

  private extractMetadata($: cheerio.CheerioAPI, url: string): Record<string, any> {
    const metadata: Record<string, any> = {
      url,
      extractedAt: new Date().toISOString()
    };
    
    // Open Graph 元數據
    $('meta[property^="og:"]').each((_, el) => {
      const property = $(el).attr('property')?.replace('og:', '');
      const content = $(el).attr('content');
      if (property && content) {
        metadata[property] = content;
      }
    });
    
    // Twitter Card 元數據
    $('meta[name^="twitter:"]').each((_, el) => {
      const name = $(el).attr('name')?.replace('twitter:', '');
      const content = $(el).attr('content');
      if (name && content) {
        metadata[`twitter_${name}`] = content;
      }
    });
    
    // 標準元數據
    const metaTags = ['description', 'keywords', 'author', 'publisher'];
    metaTags.forEach(tag => {
      const content = $(`meta[name="${tag}"]`).attr('content');
      if (content) {
        metadata[tag] = content;
      }
    });
    
    return metadata;
  }

  private extractImages($: cheerio.CheerioAPI, baseUrl: string): string[] {
    const images: string[] = [];
    
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        try {
          const absoluteUrl = new URL(src, baseUrl).href;
          images.push(absoluteUrl);
        } catch {
          // 忽略無效的URL
        }
      }
    });
    
    return images;
  }

  private extractLinks($: cheerio.CheerioAPI, baseUrl: string): Array<{ text: string; url: string }> {
    const links: Array<{ text: string; url: string }> = [];
    
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      
      if (href && text) {
        try {
          const absoluteUrl = new URL(href, baseUrl).href;
          links.push({ text, url: absoluteUrl });
        } catch {
          // 忽略無效的URL
        }
      }
    });
    
    return links;
  }

  private postProcessMarkdown(markdown: string, options: ProcessingOptions): string {
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
    
    // 應用長度限制
    if (options.minTextLength && processed.length < options.minTextLength) {
      throw new Error(`內容太短，少於 ${options.minTextLength} 個字符`);
    }
    
    if (options.maxTextLength && processed.length > options.maxTextLength) {
      processed = processed.substring(0, options.maxTextLength) + '...';
    }
    
    return processed.trim();
  }

  private countWords(text: string): number {
    // 支持中文和英文的字數統計
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = text
      .replace(/[\u4e00-\u9fff]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 0).length;
    
    return chineseChars + englishWords;
  }

  private calculateReadingTime(wordCount: number): number {
    // 假設中文每分鐘能讀250字，英文每分鐘能讀200詞
    const averageReadingSpeed = 225;
    return Math.ceil(wordCount / averageReadingSpeed);
  }

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

  private detectLanguage(text: string): string {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const totalChars = text.replace(/\s/g, '').length;
    
    if (chineseChars / totalChars > 0.3) {
      return 'zh';
    }
    
    return 'en';
  }
} 