# 部署故障排查 — embersoullabs.com

## 当前诊断（2026-06-19）

| 检查项 | 结果 |
|--------|------|
| `https://embersoullabs.com` | **522** — Cloudflare 连不上源站 |
| `https://www.embersoullabs.com` | **525** — SSL 握手失败 |
| DNS 已指向 Cloudflare | 是（104.21.x / 172.67.x） |
| `*.pages.dev` 可访问 | **未找到** — Pages 项目可能未部署成功或未绑定域名 |

**结论：** 域名已在 Cloudflare，但 **DNS 没有正确指向 Cloudflare Pages**，或 **Pages 里未添加自定义域名**。

---

## 修复步骤（按顺序做）

### 1. 确认 Pages 部署成功

1. Cloudflare → **Workers & Pages** → 你的项目
2. 打开 **Deployments**，最新一条应为 **Success**
3. 点击 **Visit** 或记下 `https://<项目名>.pages.dev` 地址
4. **在浏览器直接打开 `.pages.dev` 链接** — 必须能先看到官网

若 `.pages.dev` 都打不开：

- 重新 **Upload assets**，注意上传的是 `website/` **里面的文件**（`index.html` 在 ZIP/文件夹根目录），不是外层 `website` 文件夹
- 正确结构：

```
index.html
css/
assets/
privacy/
terms/
_redirects
```

### 2. 绑定自定义域名（最重要）

在 Pages 项目 → **Custom domains** → **Set up a custom domain**：

1. 添加 `embersoullabs.com`
2. 添加 `www.embersoullabs.com`
3. 等待状态变为 **Active**（可能 5–30 分钟）

同一 Cloudflare 账号下，通常会自动写入 DNS，无需手填。

### 3. 清理冲突 DNS 记录

Cloudflare → **DNS** → **Records**：

**删除：**

| 类型 | 名称 | 内容 |
|------|------|------|
| A | `@` | `192.64.119.4` 或任何非 Pages 的 IP |
| CNAME | `www` | `parkingpage.namecheap.com` |

**保留：** 所有 MX、SPF TXT、`_dmarc` TXT

**应有（由 Pages 自动添加或手动添加）：**

| 类型 | 名称 | 内容 | 代理 |
|------|------|------|------|
| CNAME | `@` | `<你的项目>.pages.dev` | 已代理（橙云） |
| CNAME | `www` | `<你的项目>.pages.dev` | 已代理（橙云） |

若已有指向错误目标的 **A 记录 @**，会与 Pages 冲突并导致 **522**。

### 4. SSL 设置

Cloudflare → **SSL/TLS** → 概览 → 选 **Full** 或 **Full (strict)**

### 5. 验证

```powershell
curl.exe -I https://embersoullabs.com
curl.exe -I https://www.embersoullabs.com
```

应返回 **HTTP/1.1 200** 或 **301**（www 跳转）。

---

## 常见错误

| 现象 | 原因 | 处理 |
|------|------|------|
| 522 | DNS 指向错误源 / 未绑 Pages 域名 | 完成步骤 2、3 |
| 525 | SSL 与源站不匹配 | SSL 设为 Full；等证书签发 |
| 404 on pages.dev | 上传目录结构错误 | `index.html` 必须在根目录 |
| 页面无样式 | 漏传 `css/`、`assets/` | 重新上传完整 `website/` 内容 |
| 仍显示 Namecheap 停放页 | 旧 A 记录未删 / DNS 未刷新 | 删 A 记录，等 30 分钟 |

---

## 用命令行部署（可选）

需先在 Cloudflare 创建 API Token（Pages Edit 权限），然后：

```powershell
cd "c:\Users\USER\Desktop\EmberSoullabs\website"
$env:CLOUDFLARE_API_TOKEN = "你的token"
npx wrangler pages deploy . --project-name=embersoullabs-website
```

部署后在 Dashboard 绑定 `embersoullabs.com`。
