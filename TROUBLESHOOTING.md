# 🔧 疑難排解指南

## ❗ 常見問題與解決方案

### 1. Node.js 版本相容性問題

#### 問題現象
```bash
npm WARN EBADENGINE Unsupported engine {
npm WARN EBADENGINE   package: 'undici@7.10.0',
npm WARN EBADENGINE   required: { node: '>=20.18.1' },
npm WARN EBADENGINE   current: { node: 'v20.10.0', npm: '10.2.3' }
npm WARN EBADENGINE }
```

#### 解決方案
更新您的 Node.js 版本到 20.18.1 或更高版本：

**Windows 用戶：**
1. 前往 [Node.js 官網](https://nodejs.org/)
2. 下載最新的 LTS 版本 (v22.15.0 或更高)
3. 執行安裝程式

**使用 nvm 的用戶：**
```bash
# 安裝最新的 LTS 版本
nvm install --lts
nvm use --lts

# 或安裝特定版本
nvm install 22.15.0
nvm use 22.15.0
```

#### 驗證安裝
```bash
node --version  # 應該顯示 v22.15.0 或更高
npm --version
```

---

### 2. 模組找不到問題 (Cannot find module './db.json')

#### 問題現象
```bash
Error: Cannot find module './db.json'
Require stack:
- C:\Users\...\node_modules\form-data\node_modules\mime-db\index.js
```

#### 可能原因
- npm 快取損壞
- 依賴安裝不完整
- Node.js 版本不相容

#### 解決方案

**1. 清理 npm 快取**
```bash
npm cache clean --force
```

**2. 更新 Node.js 到相容版本**
確保使用 Node.js v20.18.1 或更高版本

**3. 重新安裝依賴**
```bash
npm install -g website-to-markdown-mcp
```

**4. 使用本地安裝（替代方案）**
如果 npx 仍有問題，可以使用本地安裝：
```bash
git clone https://github.com/your-username/website-to-markdown-mcp.git
cd website-to-markdown-mcp
npm install
npm run build
```

然後在 `.cursor/mcp.json` 中使用本地路徑：
```json
{
  "mcpServers": {
    "website-to-markdown": {
      "command": "node",
      "args": ["./website-to-markdown-mcp/dist/index.js"],
      "disabled": false,
      "env": {
        "WEBSITES_CONFIG_PATH": "./my-websites.json"
      }
    }
  }
}
```

---

### 3. Windows PowerShell 語法問題

#### 問題現象
```bash
在這個版本中 '&&' 語彙基元不是有效的陳述式分隔符號。
```

#### 解決方案
**方法 1：分別執行命令**
```powershell
npm install
npm run build
```

**方法 2：使用 PowerShell 語法**
```powershell
npm install; npm run build
```

**方法 3：使用 cmd**
```cmd
npm install && npm run build
```

---

## 🔍 診斷工具

### 檢查環境
```bash
# 檢查 Node.js 版本
node --version

# 檢查 npm 版本
npm --version

# 檢查全域安裝的套件
npm list -g --depth=0

# 檢查 npx 快取
npx --version
```

### 清理環境
```bash
# 清理 npm 快取
npm cache clean --force

# 清理 npx 快取 (Windows)
rmdir /s "%USERPROFILE%\.npm\_npx"

# 清理 npx 快取 (macOS/Linux)
rm -rf ~/.npm/_npx
```

---

## 📋 推薦配置

### 最小系統需求
- **Node.js**: v20.18.1 或更高 (推薦 v22.15.0 LTS)
- **npm**: v10.0.0 或更高
- **作業系統**: Windows 10+, macOS 10.15+, Linux (Ubuntu 18.04+)

### 穩定配置範例
```json
{
  "mcpServers": {
    "website-to-markdown": {
      "command": "npx",
      "args": ["-y", "website-to-markdown-mcp"],
      "disabled": false,
      "env": {
        "WEBSITES_CONFIG_PATH": "./my-websites.json",
        "NODE_ENV": "production"
      }
    }
  }
}
```

---

## 🆘 仍有問題？

如果以上解決方案都無法解決您的問題：

1. **檢查 Issues**: 查看 [GitHub Issues](https://github.com/your-username/website-to-markdown-mcp/issues)
2. **建立新 Issue**: 提供以下資訊：
   - Node.js 版本 (`node --version`)
   - npm 版本 (`npm --version`)
   - 作業系統版本
   - 完整錯誤訊息
   - 重現步驟

3. **聯絡方式**: 
   - GitHub Issues (推薦)
   - 討論區 (如果有的話)

---

## 📈 效能最佳化提示

- 使用最新的 Node.js LTS 版本
- 定期清理 npm 快取
- 使用穩定的網路連線
- 考慮使用 yarn 作為套件管理器的替代方案 