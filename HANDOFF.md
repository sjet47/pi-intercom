# HANDOFF

### TL;DR
`intercom list` 的当前 cwd 分组标题现在显示 `[current]`；类型检查和 57 项测试均已通过。

### 全局事实
- Presence 保留并发布 `idle`、`thinking`、`tool:<name>` 等细粒度生命周期状态；list 只将其显示归一化。
- `list_all` 默认 `false`：默认仅显示调用者 cwd 的 session；设为 `true` 时按 cwd 分组显示所有已连接 session。
- CI 用 npm install 而非 npm ci：package-lock.json 被 .gitignore，peer deps 有意装最新。

### TODO
- （无）
