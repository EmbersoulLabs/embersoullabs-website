# 企业邮箱设置（Namecheap 邮件转发）

Cloudflare DNS 中的 **MX 记录已正确**，无需修改。邮箱别名在 **Namecheap** 控制台配置。

## 需要建立的邮箱

| 邮箱 | 说明 |
|------|------|
| `support@embersoullabs.com` | 官网主联系 / 客户支持 |
| `founder@embersoullabs.com` | 可选 — 创始人联系 |

## 设置步骤

1. 登录 [Namecheap](https://www.namecheap.com) → **Domain List** → `embersoullabs.com` → **Manage**
2. 进入 **Redirect Email** 或 **Email Forwarding**
3. 添加别名，转发到你的个人邮箱：

| Alias | Forward to |
|-------|------------|
| `support` | `你的个人邮箱@gmail.com` |
| `founder` | `你的个人邮箱@gmail.com`（可选） |

4. 保存后等待 **5–30 分钟** 生效

## 验证

从外部邮箱发送测试邮件到 `support@embersoullabs.com`，确认能收到。

## 注意

- **不要删除** Cloudflare 中的 MX 记录
- **不要删除** SPF TXT 记录
