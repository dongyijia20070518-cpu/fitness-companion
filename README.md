# 向好 · Wellward

移动端优先、iPad/Mac 响应式的健身减脂记录网站。使用 Sites 托管身份与 Cloudflare D1，不再依赖单设备 `localStorage` 保存主数据。

## 已实现

- 同一 ChatGPT 账号跨设备同步，服务端按稳定用户 ID 隔离数据。
- 首次昵称、欢迎动画与健康档案；新账号默认完全空数据。
- Today / Plan / Workout / Lab / Me 五个主页面。
- 50+ 个中英双语动作，按部位、器械筛选，支持私有自定义动作。
- 触控拖动排序，同时提供上移/下移按钮；可恢复科学建议顺序。
- 训练与休息使用绝对时间戳，刷新、切后台或锁屏后按真实时间恢复。
- 训练组的重量、次数、RIR、动作质量与完成状态。
- 体重、饮食、计划、训练历史和复盘图表。
- 离线本地队列、在线重试、乐观版本冲突检测与按记录更新时间合并。
- JSON 导出、云端数据删除与清楚的隐私说明。

## 身份与安全

Sites 在站点外层完成真实账户登录；应用从受信请求头读取稳定用户 ID 与邮箱，不保存或接触密码。数据库主键和每次查询均使用该用户 ID，因此不会按可变邮箱串联数据。

若将来需要向非 ChatGPT 用户公开普通“邮箱 + 密码”注册，可把站点改为公开并接入 Supabase Auth。届时需要用户提供 Supabase Project URL、Publishable/Anon Key、邮件模板/SMTP（用于验证与重置密码）并重新审计访问策略；当前私有版本不需要这些密钥。

## 计时边界

训练保存 `startedAt`，休息保存 `endAt`，恢复时使用当前时间计算，不依赖网页后台每秒运行。移动浏览器仍可能暂停 JavaScript；Web 通知也取决于浏览器、操作系统与用户授权，因此网页不能承诺像原生 App 一样后台常驻。

## 本地开发

要求 Node.js 22.13+。

1. 安装依赖：`npm ci`
2. 构建一次：`npm run build`
3. 应用本地 D1 迁移：
   `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_conscious_quasimodo.sql`
4. 启动：`npm run dev`
5. 本地登录入口：`/signin-with-chatgpt?return_to=/`

托管发布由 Sites 工作流读取 `.openai/hosting.json`、自动应用 `drizzle/` 迁移并部署 Worker；不需要把密钥写进仓库。

## 通过 GitHub 更新版本

`main` 是稳定分支。建议每次改动从独立分支开始，提交前在本地运行 `npm ci` 和 `npm run build`，再通过 Pull Request 合并到 `main`。GitHub Actions 会在每次推送和 Pull Request 时重新安装依赖并执行正式构建。

环境变量、私钥、本地数据库、构建目录和部署归档均由 `.gitignore` 排除。不要把访问令牌、数据库密码或服务端密钥写入源码；需要运行时密钥时，应通过托管平台或 GitHub Actions Secrets 配置。

GitHub 用于源码版本管理与构建验证；当前线上 Sites 站点的正式发布仍使用 Sites 的受控发布流程，以保留现有账户身份、D1 数据库和访问权限。

## 训练依据与内容来源

- [WHO 身体活动与久坐行为指南](https://www.who.int/publications-detail-redirect/9789240015128)
- [ACSM 动作顺序资料](https://chapters.acsm.org/docs/default-source/files-for-resource-library/infographics/inclusive-fitness/acsm-nchpad-anaerobic-programming-for-clients-with-disabilities.pdf)

动作名称、提示与安全文案由产品内置整理，没有抓取第三方教学视频。站内规则不是医学诊断，异常疼痛、胸痛、晕厥感或明显气短时应停止训练并寻求专业帮助。
