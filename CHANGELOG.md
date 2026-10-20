# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-10-20

首个公开版本。

### 工具

- `mp_scan` — 工程体检：页面清单、文件完整性、未注册的孤儿页、tabBar / 分包 / usingComponents 校验、包体积
- `mp_page_add` — 建页面 + 自动注册 + 写完自检；已存在文件默认不覆盖
- `mp_page_remove` — 注销页面，可连文件一起删；拦掉删启动页 / tab 页 / 最后一个页面
- `mp_entry_set` — 改启动页并同步 `entryPagePath`
- `mp_register` — 只补注册已存在的页面
- `mp_fix` — 一键补注册所有孤儿页
- `mp_subpackage_add` — 建分包 + 校验 root + 首个页面登记到分包
- `mp_component_add` — 建组件 + 注入 `usingComponents`
- `mp_tabbar` — 一行配置底部导航，校验 2–5 数量与图标
- `mp_project_init` — 生成可导入开发者工具的工程骨架
- `mp_devtools` — 调微信开发者工具 CLI：打开 / 预览二维码 / 上传 / 查登录

### 关键设计

- 区分 `project.config.json` 的「项目根」与 `miniprogramRoot` 指定的「代码根」
- 内置 JSONC 解析与区间替换编辑，改 `app.json` 时保留注释与格式
- 分包页面登记到分包 `pages`，绝不写进主包
- 路径穿越防护；可预期的用户错误返回可读提示而非抛异常
- 开发者工具 CLI 超时保护与失败归因（权限 / 初始化 / 未登录 / 端口）
