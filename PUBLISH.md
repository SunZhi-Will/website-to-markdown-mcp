# 📦 NPM 套件發布指南

## 🚀 發布步驟

### 1. 準備發布

```bash
# 確保所有依賴都已安裝
npm install

# 建置專案
npm run build

# 檢查打包內容
npm pack --dry-run
```

### 2. 版本管理

```bash
# 更新版本號 (patch/minor/major)
npm version patch

# 或手動編輯 package.json 中的版本號
```

### 3. 發布到 NPM

```bash
# 登入 npm (如果尚未登入)
npm login

# 發布套件
npm publish
```

### 4. 驗證發布

```bash
# 使用 npx 測試
npx website-to-markdown-mcp

# 或安裝後測試
npm install -g website-to-markdown-mcp
website-to-markdown-mcp
```

## 🎯 使用方式

發布後，用戶可以在 `.cursor/mcp.json` 中這樣配置：

```json
{
  "mcpServers": {
    "website-to-markdown": {
      "command": "npx",
      "args": ["-y", "website-to-markdown-mcp"],
      "disabled": false,
      "env": {
        "WEBSITES_CONFIG_PATH": "./my-websites.json"
      }
    }
  }
}
```

## 📋 套件特色

- ✅ 支援 `npx` 直接運行
- ✅ 包含完整的 OpenAPI/Swagger 支援
- ✅ 可透過環境變數配置
- ✅ 自動依賴管理
- ✅ TypeScript 型別支援

## 🔧 故障排除

如果遇到問題：

1. **確保 Node.js 版本 >= 20.18.1** (推薦 v22.15.0 LTS)
2. 檢查網路連線
3. 確認 package.json 中的 repository URL 正確
4. 檢查 npm 登入狀態：`npm whoami`
5. 清理快取：`npm cache clean --force`

### 常見發布問題

**引擎相容性警告：**
```bash
npm WARN EBADENGINE Unsupported engine
```
**解決方案：** 確保本地開發環境使用支援的 Node.js 版本

**模組依賴問題：**
- 在發布前執行 `npm install` 確保所有依賴正確安裝
- 檢查 `package.json` 中的 `engines` 欄位設定
- 使用 `npm pack --dry-run` 預覽發布內容 