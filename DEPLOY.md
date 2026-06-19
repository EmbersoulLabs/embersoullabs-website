# EmberSoul Labs 官网部署指南

静态官网位于 `website/` 目录，推荐部署到 **Cloudflare Pages**（DNS 已在 Cloudflare）。

## 一、本地预览

```powershell
cd "c:\Users\USER\Desktop\EmberSoullabs\website"
npx --yes serve .
```

浏览器打开 `http://localhost:3000`

## 二、部署到 Cloudflare Pages

### 方式 A — 拖拽上传（最快）

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create**
2. 选择 **Pages** → **Upload assets**
3. 项目名：`embersoullabs-website`
4. 将整个 `website/` 文件夹内容拖入上传
5. 部署完成后获得地址：`https://embersoullabs-website.pages.dev`

### 方式 B — 连接 Git（推荐长期维护）

1. 将 `website/` 推送到 GitHub 仓库
2. Cloudflare Pages → **Connect to Git** → 选择仓库
3. 构建设置：
   - **Framework preset:** None
   - **Build command:** （留空）
   - **Build output directory:** `/` 或 `website`（取决于仓库结构）

## 三、绑定自定义域名

在 Cloudflare Pages 项目 → **Custom domains** → **Set up a custom domain**：

1. 添加 `embersoullabs.com`
2. 添加 `www.embersoullabs.com`（可选，或用重定向规则）

Cloudflare 会自动在 DNS 中添加 CNAME 记录（若域名已在同一 Cloudflare 账号）。

### 手动 DNS（若未自动添加）

| 操作 | 类型 | 名称 | 内容 |
|------|------|------|------|
| **删除** | A | `@` | `192.64.119.43` |
| **删除** | CNAME | `www` | `parkingpage.namecheap.com` |
| **添加** | CNAME | `@` | `embersoullabs-website.pages.dev` |
| **保留** | MX | `@` | *现有邮件记录* |
| **保留** | TXT | `@` | SPF 记录 |

### www 重定向

`website/_redirects` 已包含 www → 主域名 301 规则。也可在 Cloudflare **Rules → Redirect Rules** 配置。

## 四、验证

```powershell
nslookup embersoullabs.com
curl -I https://embersoullabs.com
curl -I https://www.embersoullabs.com
```

- 主页显示 EmberSoul Labs Logo
- 产品卡片：EmberCore ERP、EmberOS（开发中）
- 邮件 `support@embersoullabs.com` 可点击
- 发测试邮件确认转发仍正常

## 五、更新网站

修改 `website/` 内文件后重新上传或 `git push`（若已连接 Git），Pages 会自动重新部署。
