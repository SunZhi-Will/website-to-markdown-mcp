@echo off
echo Installing Website to Markdown MCP Server...
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Please install Node.js first
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js version:
node --version
echo.

REM Install dependencies
echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo Error: Dependencies installation failed
    pause
    exit /b 1
)

echo.
echo Building project...
call npm run build
if %errorlevel% neq 0 (
    echo Error: Project build failed
    pause
    exit /b 1
)

echo.
echo ✅ Installation completed!
echo.
echo 📋 Next steps:
echo 1. Make sure .cursor/mcp.json is configured with this MCP server
echo 2. Restart Cursor
echo 3. Use Agent mode in Chat
echo 4. Try this command: "Please list all configured websites"
echo.
echo 📖 For more information, see README.md
echo.
pause 