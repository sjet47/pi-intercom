# HANDOFF

### TL;DR
正在为 `intercom({ action: "list" })` 增加 cwd 过滤/分组和简化的 working/idle 状态展示；用户要求拆为两次独立提交。

### 全局事实
- Presence 已发布 `idle`、`thinking`、`tool:<name>` 等细粒度生命周期状态；第二个提交将 list 的显示规范化为 `working`/`idle`。
- `list_all` 默认 `false`：默认仅显示调用者 cwd 的 session；设为 `true` 时按 cwd 分组显示所有已连接 session。
- CI 用 npm install 而非 npm ci：package-lock.json 被 .gitignore，peer deps 有意装最新。

### WIP
- 子任务 1：修改 `index.ts` 的 intercom list schema 和输出，补 integration 覆盖，随后单独提交。

### TODO
- 完成 cwd 分组与 `list_all` 的测试、提交。
- 显示 session 的 `working`/`idle` 状态并独立提交。
- 运行 `npm run check`、`npm test`。
