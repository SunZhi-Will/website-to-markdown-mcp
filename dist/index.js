#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validate, dereference } from '@readme/openapi-parser';
import { parse as parseYaml } from 'yaml';
// Configuration Schema
const ConfigSchema = z.object({
    websites: z.array(z.object({
        name: z.string(),
        url: z.string().url(),
        description: z.string().optional()
    }))
});
// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Get configuration from config file or environment variables
const getConfig = () => {
    // 1. First check environment variable specified config file path
    const configPath = process.env.WEBSITES_CONFIG_PATH;
    if (configPath) {
        try {
            let fullPath = configPath;
            // If relative path, relative to current working directory
            if (!configPath.startsWith('/') && !configPath.includes(':')) {
                fullPath = join(process.cwd(), configPath);
            }
            if (existsSync(fullPath)) {
                const configFile = readFileSync(fullPath, 'utf-8');
                const parsed = JSON.parse(configFile);
                console.error(`Loading configuration from specified file: ${fullPath}`);
                return ConfigSchema.parse(parsed);
            }
            else {
                console.error(`Specified configuration file does not exist: ${fullPath}`);
            }
        }
        catch (error) {
            console.error('Failed to read specified configuration file:', error);
        }
    }
    // 2. Try to get configuration from environment variables (backward compatibility)
    const configJson = process.env.WEBSITES_CONFIG;
    if (configJson) {
        try {
            const parsed = JSON.parse(configJson);
            console.error('Loading configuration from environment variable');
            return ConfigSchema.parse(parsed);
        }
        catch (error) {
            console.error('Environment variable configuration parsing error:', error);
        }
    }
    // 3. Try to read default config.json file
    const defaultConfigPath = join(__dirname, '..', 'config.json');
    if (existsSync(defaultConfigPath)) {
        try {
            const configFile = readFileSync(defaultConfigPath, 'utf-8');
            const parsed = JSON.parse(configFile);
            console.error(`Loading configuration from default file: ${defaultConfigPath}`);
            return ConfigSchema.parse(parsed);
        }
        catch (error) {
            console.error('Failed to read default configuration file:', error);
        }
    }
    // 4. Use built-in default configuration
    console.error('Using built-in default configuration');
    return {
        websites: [
            {
                name: "tailwind_css",
                url: "https://tailwindcss.com",
                description: "Tailwind CSS Official Website"
            },
            {
                name: "nextjs",
                url: "https://nextjs.org",
                description: "Next.js Official Documentation"
            },
            {
                name: "react",
                url: "https://react.dev",
                description: "React Official Documentation"
            }
        ]
    };
};
// Turndown configuration
const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```'
});
// Add rules to handle more HTML elements
turndownService.addRule('strikethrough', {
    filter: ['del', 's'],
    replacement: (content) => `~~${content}~~`
});
turndownService.addRule('underline', {
    filter: 'u',
    replacement: (content) => `<u>${content}</u>`
});
// OpenAPI/Swagger detection function
function isOpenAPIContent(content) {
    try {
        const parsed = JSON.parse(content);
        return !!(parsed.openapi || parsed.swagger);
    }
    catch {
        // Try to detect YAML format
        const lowerContent = content.toLowerCase();
        return lowerContent.includes('openapi:') ||
            lowerContent.includes('swagger:') ||
            lowerContent.includes('openapi ') ||
            lowerContent.includes('swagger ') ||
            // More comprehensive Swagger 2.0 detection
            (lowerContent.includes('swagger') && (lowerContent.includes('paths:') ||
                lowerContent.includes('definitions:') ||
                lowerContent.includes('info:')));
    }
}
// OpenAPI parsing and formatting function
async function parseOpenAPISpec(content) {
    try {
        let spec;
        let isValid = true;
        let errors = [];
        // Try to parse JSON
        try {
            spec = JSON.parse(content);
        }
        catch {
            // If JSON parsing fails, try YAML parsing
            try {
                spec = parseYaml(content);
            }
            catch {
                // If both fail, try simple manual parsing
                const lines = content.split('\n');
                spec = {};
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('openapi:')) {
                        spec.openapi = trimmed.split(':')[1]?.trim().replace(/['"]/g, '');
                    }
                    else if (trimmed.startsWith('swagger:')) {
                        spec.swagger = trimmed.split(':')[1]?.trim().replace(/['"]/g, '');
                    }
                    else if (trimmed.startsWith('title:')) {
                        if (!spec.info)
                            spec.info = {};
                        spec.info.title = trimmed.split(':')[1]?.trim().replace(/['"]/g, '');
                    }
                    else if (trimmed.startsWith('version:')) {
                        if (!spec.info)
                            spec.info = {};
                        spec.info.version = trimmed.split(':')[1]?.trim().replace(/['"]/g, '');
                    }
                }
            }
        }
        // Use professional OpenAPI validator
        try {
            const specString = typeof spec === 'string' ? spec : JSON.stringify(spec);
            const validationResult = await validate(specString);
            isValid = validationResult.valid || false;
            if (!isValid && 'errors' in validationResult) {
                errors = Array.isArray(validationResult.errors)
                    ? validationResult.errors.map(err => typeof err === 'string' ? err : err.message || String(err))
                    : [];
            }
        }
        catch {
            // If professional validator fails, use basic validation
            if (!spec.openapi && !spec.swagger) {
                errors.push('Missing openapi or swagger version declaration');
                isValid = false;
            }
            if (!spec.info?.title) {
                errors.push('Missing API title');
                isValid = false;
            }
            if (!spec.info?.version) {
                errors.push('Missing API version');
                isValid = false;
            }
        }
        // Try to resolve references
        try {
            const specString = typeof spec === 'string' ? spec : JSON.stringify(spec);
            const dereferenced = await dereference(specString);
            spec = dereferenced;
        }
        catch (dereferenceError) {
            console.error('Failed to resolve references:', dereferenceError);
            // Continue with original spec
        }
        // Format OpenAPI document
        const formatted = formatOpenAPISpec(spec);
        // Generate summary
        const summary = generateOpenAPISummary(spec);
        return {
            spec,
            formatted,
            summary,
            isValid,
            errors: errors.length > 0 ? errors : undefined
        };
    }
    catch (error) {
        return {
            spec: {},
            formatted: content,
            summary: 'OpenAPI parsing failed',
            isValid: false,
            errors: [`Parsing error: ${error instanceof Error ? error.message : String(error)}`]
        };
    }
}
// Format OpenAPI spec to Markdown
function formatOpenAPISpec(spec) {
    const lines = [];
    // Basic information
    lines.push(`## API Basic Information\n`);
    lines.push(`- **API Name**: ${spec.info?.title || 'Unknown'}`);
    lines.push(`- **Version**: ${spec.info?.version || 'Unknown'}`);
    if (spec.openapi) {
        lines.push(`- **OpenAPI Version**: ${spec.openapi}`);
    }
    else if (spec.swagger) {
        lines.push(`- **Swagger Version**: ${spec.swagger}`);
    }
    if (spec.info?.description) {
        lines.push(`- **Description**: ${spec.info.description}`);
    }
    lines.push('');
    // Server information
    if (spec.servers && spec.servers.length > 0) {
        lines.push(`## Servers\n`);
        spec.servers.forEach((server, index) => {
            lines.push(`${index + 1}. **${server.url}**`);
            if (server.description) {
                lines.push(`   - ${server.description}`);
            }
        });
        lines.push('');
    }
    else if (spec.host || spec.basePath || spec.schemes) {
        // Swagger 2.0 format server information
        lines.push(`## Server Information\n`);
        if (spec.host) {
            lines.push(`- **Host**: ${spec.host}`);
        }
        if (spec.basePath) {
            lines.push(`- **Base Path**: ${spec.basePath}`);
        }
        if (spec.schemes && spec.schemes.length > 0) {
            lines.push(`- **Supported Protocols**: ${spec.schemes.join(', ')}`);
        }
        if (spec.consumes && spec.consumes.length > 0) {
            lines.push(`- **Accept Formats**: ${spec.consumes.join(', ')}`);
        }
        if (spec.produces && spec.produces.length > 0) {
            lines.push(`- **Response Formats**: ${spec.produces.join(', ')}`);
        }
        lines.push('');
    }
    // Paths summary
    if (spec.paths && Object.keys(spec.paths).length > 0) {
        lines.push(`## API Endpoints\n`);
        const pathCount = Object.keys(spec.paths).length;
        lines.push(`Total of **${pathCount}** endpoints:\n`);
        Object.entries(spec.paths).forEach(([path, methods]) => {
            if (typeof methods === 'object' && methods !== null) {
                const methodList = Object.keys(methods).filter(key => ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace'].includes(key.toLowerCase()));
                if (methodList.length > 0) {
                    lines.push(`### \`${path}\``);
                    methodList.forEach(method => {
                        const operation = methods[method];
                        const summary = operation?.summary || operation?.operationId || `${method.toUpperCase()} operation`;
                        lines.push(`- **${method.toUpperCase()}**: ${summary}`);
                        if (operation?.description) {
                            lines.push(`  - ${operation.description}`);
                        }
                    });
                    lines.push('');
                }
            }
        });
    }
    // Component summary (OpenAPI 3.x)
    if (spec.components) {
        lines.push(`## Components\n`);
        if (spec.components.schemas) {
            const schemaCount = Object.keys(spec.components.schemas).length;
            lines.push(`- **Schemas**: ${schemaCount} data models`);
        }
        if (spec.components.parameters) {
            const paramCount = Object.keys(spec.components.parameters).length;
            lines.push(`- **Parameters**: ${paramCount} reusable parameters`);
        }
        if (spec.components.responses) {
            const responseCount = Object.keys(spec.components.responses).length;
            lines.push(`- **Responses**: ${responseCount} reusable responses`);
        }
        if (spec.components.securitySchemes) {
            const securityCount = Object.keys(spec.components.securitySchemes).length;
            lines.push(`- **Security Schemes**: ${securityCount} security mechanisms`);
        }
        lines.push('');
    }
    else if (spec.definitions || spec.parameters || spec.responses || spec.securityDefinitions) {
        // Swagger 2.0 format components
        lines.push(`## Definitions\n`);
        if (spec.definitions) {
            const definitionCount = Object.keys(spec.definitions).length;
            lines.push(`- **Definitions**: ${definitionCount} data models`);
        }
        if (spec.parameters) {
            const paramCount = Object.keys(spec.parameters).length;
            lines.push(`- **Parameters**: ${paramCount} reusable parameters`);
        }
        if (spec.responses) {
            const responseCount = Object.keys(spec.responses).length;
            lines.push(`- **Responses**: ${responseCount} reusable responses`);
        }
        if (spec.securityDefinitions) {
            const securityCount = Object.keys(spec.securityDefinitions).length;
            lines.push(`- **Security Definitions**: ${securityCount} security definitions`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
// Generate OpenAPI summary
function generateOpenAPISummary(spec) {
    const title = spec.info?.title || 'API';
    const version = spec.info?.version || 'Unknown version';
    const pathCount = spec.paths ? Object.keys(spec.paths).length : 0;
    const specType = spec.openapi ? `OpenAPI ${spec.openapi}` : spec.swagger ? `Swagger ${spec.swagger}` : 'API Spec';
    return `${title} (${version}) - ${specType} specification with ${pathCount} endpoints`;
}
// Enhanced website content fetching function (supports OpenAPI detection)
async function fetchWebsiteContent(url) {
    try {
        console.error(`Fetching website: ${url}`);
        const response = await axios.get(url, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8,application/json,application/yaml',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });
        // Check if it's a direct OpenAPI/JSON/YAML file
        const contentType = response.headers['content-type'] || '';
        const rawContent = response.data;
        if (contentType.includes('application/json') ||
            contentType.includes('application/yaml') ||
            contentType.includes('text/yaml') ||
            url.endsWith('.json') ||
            url.endsWith('.yaml') ||
            url.endsWith('.yml') ||
            (typeof rawContent === 'string' && isOpenAPIContent(rawContent))) {
            console.error(`Detected OpenAPI specification file: ${url}`);
            const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2);
            const openAPIData = await parseOpenAPISpec(content);
            return {
                title: openAPIData.spec.info?.title || 'Unknown API',
                content: openAPIData.summary,
                markdown: openAPIData.formatted,
                isOpenAPI: true,
                openAPIData
            };
        }
        // Handle general webpage content
        const $ = cheerio.load(response.data);
        // Remove scripts, styles and other unnecessary elements
        $('script, style, nav, footer, .nav, .footer, .sidebar, .ads, .advertisement').remove();
        // Get title
        const title = $('title').text() || $('h1').first().text() || 'Untitled';
        // Get main content
        let content = '';
        // Try to find main content area
        const mainSelectors = [
            'main',
            'article',
            '.content',
            '.main-content',
            '.post-content',
            '.entry-content',
            '#content',
            '#main'
        ];
        let $mainContent = null;
        for (const selector of mainSelectors) {
            $mainContent = $(selector);
            if ($mainContent.length > 0) {
                break;
            }
        }
        // If no main content area found, use body
        if (!$mainContent || $mainContent.length === 0) {
            $mainContent = $('body');
        }
        content = $mainContent.html() || '';
        // Convert to markdown
        const markdown = turndownService.turndown(content);
        // Clean markdown
        const cleanMarkdown = markdown
            .replace(/\n{3,}/g, '\n\n') // Remove excessive blank lines
            .replace(/^\s+$/gm, '') // Remove lines with only whitespace
            .trim();
        console.error(`Successfully fetched website: ${title}`);
        return {
            title,
            content: $mainContent.text().slice(0, 1000), // Limit plain text content length
            markdown: cleanMarkdown
        };
    }
    catch (error) {
        console.error(`Failed to fetch website ${url}:`, error);
        throw new McpError(ErrorCode.InternalError, `Unable to fetch website ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
// Create MCP server
const server = new Server({
    name: 'website-to-markdown',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Register tools list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
    const config = getConfig();
    const tools = [
        {
            name: 'fetch_website',
            description: 'Fetch specified website and convert to markdown format',
            inputSchema: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'Website URL to fetch'
                    }
                },
                required: ['url']
            }
        },
        {
            name: 'list_configured_websites',
            description: 'List all configured websites',
            inputSchema: {
                type: 'object',
                properties: {}
            }
        }
    ];
    // Create dedicated tools for each configured website
    config.websites.forEach(site => {
        tools.push({
            name: `fetch_${site.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
            description: `Fetch ${site.name} (${site.url}) and convert to markdown format${site.description ? ` - ${site.description}` : ''}`,
            inputSchema: {
                type: 'object',
                properties: {}
            }
        });
    });
    return { tools };
});
// Search relevant websites
async function searchRelevantWebsites(query) {
    const config = getConfig();
    const results = [];
    for (const site of config.websites) {
        // Calculate relevance score
        const titleRelevance = site.description?.toLowerCase().includes(query.toLowerCase()) ? 0.3 : 0;
        const descRelevance = site.description?.toLowerCase().includes(query.toLowerCase()) ? 0.2 : 0;
        const urlRelevance = site.url.toLowerCase().includes(query.toLowerCase()) ? 0.1 : 0;
        const relevance = titleRelevance + descRelevance + urlRelevance;
        // If has any relevance, add to results
        if (relevance > 0) {
            try {
                console.error(`Fetching relevant website: ${site.name}`);
                const content = await fetchWebsiteContent(site.url);
                // Check content relevance
                const contentRelevance = content.markdown.toLowerCase().includes(query.toLowerCase()) ? 0.4 : 0;
                const totalRelevance = relevance + contentRelevance;
                if (totalRelevance > 0) {
                    results.push({
                        site,
                        relevance: totalRelevance,
                        content
                    });
                }
            }
            catch (error) {
                console.error(`Failed to fetch website ${site.name}:`, error);
            }
        }
    }
    // Sort by relevance
    return results.sort((a, b) => b.relevance - a.relevance);
}
// Register tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const config = getConfig();
    try {
        // If it's a general query (not a specific tool), search all relevant websites
        if (args && typeof args === 'object' && 'query' in args) {
            const query = args.query;
            console.error(`Received query: ${query}`);
            const results = await searchRelevantWebsites(query);
            if (results.length > 0) {
                // Combine all relevant results
                const combinedContent = results.map(result => {
                    const { site, content } = result;
                    if (!content)
                        return '';
                    return `## ${content.title}\n\n**Source**: ${site.url}\n**Website**: ${site.name}${site.description ? ` - ${site.description}` : ''}\n\n---\n\n${content.markdown}\n\n`;
                }).filter(Boolean).join('\n');
                if (combinedContent) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `# Relevant Website Search Results\n\nFound ${results.length} relevant websites:\n\n${combinedContent}`
                            }
                        ]
                    };
                }
            }
        }
        if (name === 'fetch_website') {
            const url = args?.url;
            if (!url) {
                throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: url');
            }
            const result = await fetchWebsiteContent(url);
            return {
                content: [
                    {
                        type: 'text',
                        text: `# ${result.title}\n\n**Source**: ${url}\n\n---\n\n${result.markdown}`
                    }
                ]
            };
        }
        if (name === 'list_configured_websites') {
            const websiteList = config.websites.map(site => `- **${site.name}**: ${site.url}${site.description ? ` - ${site.description}` : ''}`).join('\n');
            return {
                content: [
                    {
                        type: 'text',
                        text: `# Configured Websites\n\n${websiteList}\n\nYou can:\n1. Ask any question directly, I will automatically search relevant websites\n2. Use \`fetch_website\` tool to fetch specific websites\n3. Use corresponding dedicated tools to fetch configured websites`
                    }
                ]
            };
        }
        // Handle dedicated website tools
        const websiteMatch = config.websites.find(site => name === `fetch_${site.name.replace(/[^a-zA-Z0-9]/g, '_')}`);
        if (websiteMatch) {
            const result = await fetchWebsiteContent(websiteMatch.url);
            return {
                content: [
                    {
                        type: 'text',
                        text: `# ${result.title}\n\n**Source**: ${websiteMatch.url}\n**Website**: ${websiteMatch.name}\n\n---\n\n${result.markdown}`
                    }
                ]
            };
        }
        // If no specific tool found, try to search relevant websites
        const results = await searchRelevantWebsites(name || '');
        if (results.length > 0) {
            const combinedContent = results.map(result => {
                const { site, content } = result;
                if (!content)
                    return '';
                return `## ${content.title}\n\n**Source**: ${site.url}\n**Website**: ${site.name}${site.description ? ` - ${site.description}` : ''}\n\n---\n\n${content.markdown}\n\n`;
            }).filter(Boolean).join('\n');
            if (combinedContent) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `# Relevant Website Search Results\n\nFound ${results.length} relevant websites:\n\n${combinedContent}`
                        }
                    ]
                };
            }
        }
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    catch (error) {
        if (error instanceof McpError) {
            throw error;
        }
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
});
// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Website to Markdown MCP Server started');
}
main().catch((error) => {
    console.error('Server startup failed:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map