# Glaucus

FTC 队伍的工程笔记工具：在 Discord 或网页上记录，AI 整理成草稿，队员审核后归档。设计见 [docs/design.md](docs/design.md)。

## 部署到 VPS

需要：一台装好 Docker 的 VPS（建议内存 2 GB 以上，构建时比较吃内存）、一个域名、一个 Discord 应用。

1. **域名**：把域名的 A 记录指向 VPS。防火墙开放 80 和 443（TCP），以及 443（UDP，可选）。
2. **Discord**：在 [开发者门户](https://discord.com/developers/applications) 的应用页面：
   - OAuth2 → Redirects 添加 `https://你的域名/auth/callback`。
   - Bot → 开启 Message Content Intent。
   - 邀请 bot 进服务器，给它的角色加上 Manage Threads。设置页会检查这些，并提供邀请链接。
3. **代码**：私有仓库要先在 GitHub 添加只读的 Deploy key，然后：

   ```bash
   git clone git@github.com:HackingU0/Glaucus.git
   ```

   ```bash
   cd Glaucus && echo "DOMAIN=你的域名" > .env
   ```

4. **启动**：

   ```bash
   docker compose up -d --build
   ```

5. **设置**：取出设置令牌，打开 `https://你的域名` 按页面填写。令牌每次重启都会换。

   ```bash
   docker compose logs app
   ```

同一个 bot token 只能跑一个实例，否则每条命令都会被回应两次。部署前先停掉本地的服务。

## 日常维护

更新：

```bash
git pull && docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f app
```

修改设置：编辑 `glaucus-data` 卷里的 `settings.json` 后重启，或者删除它重新走设置页（所有人都要重新登录）。

所有数据和密钥都在 `glaucus-data` 卷里。`docker compose down -v` 会连卷一起删除，不要在正式环境运行。

## 本地开发

```bash
npm install
```

```bash
npm run dev:server
```

```bash
npm run dev
```

在 `.env` 里设置 `DEV_LOGIN=1` 可以用测试账号和示例数据，不需要 Discord。测试和类型检查：

```bash
npm test
```

```bash
npm run check
```
