## Study Assistant

轻量 Node.js + TypeScript 学习助手，包含 LINE Messaging API Webhook、番茄钟与闪卡（SQLite）。

### 快速开始（本地/Codespaces）
1. 复制环境变量示例
   ```bash
   cp .env.example .env
   # 将 .env 中的 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN / ADMIN_TOKEN 等填入新值
   ```
2. 安装与启动
   ```bash
   npm ci
   npm run build
   npm start
   ```
3. 浏览器访问：`http://localhost:3000`（或 Codespaces 公网 URL）。
4. 在 LINE Developers 控制台设置 Webhook URL：`<PUBLIC_BASE_URL>/line/webhook` 并开启。

### Docker 运行（生产建议）
```bash
docker run -d --name study-assistant \
  --restart=unless-stopped \
  -p 3000:3000 \
  --env-file /path/to/.env \
  -v /path/to/data.sqlite:/app/data.sqlite \
  ghcr.io/futurexr1995/study-assistant:main
```

### GitHub Actions
- CI：Lint + Build
- Docker：推送镜像至 GHCR（需仓库启用 packages: write 权限）

### 环境变量
- `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`（必须，使用 LINE Messaging API）
- `DEFAULT_LINE_USER_ID`（可选）
- `PUBLIC_BASE_URL`（必须，外网根地址）
- `ADMIN_TOKEN`（建议设置）
- `TZ`, `LIFF_ID`（可选）

### 安全
- `.env*` 不会被提交；如误泄漏，请旋转密钥并清理历史。


