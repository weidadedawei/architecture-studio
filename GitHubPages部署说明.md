# 将双语架构图编辑器部署到 GitHub Pages

这是一个纯静态教学项目：编辑、导入和导出都在访问者的浏览器中完成，示例数据均为虚构内容，无需配置应用服务器或数据库。

- 仓库：[weidadedawei/architecture-studio](https://github.com/weidadedawei/architecture-studio)
- 编辑器：[在线入口](https://weidadedawei.github.io/architecture-studio/)
- 教程：[操作与实现说明](https://weidadedawei.github.io/architecture-studio/guide.html)
- 附件：[源码、实例与测试脚本](https://weidadedawei.github.io/architecture-studio/downloads/Architecture_Studio_CSDN.zip)

首次发布已由 [GitHub Actions 完成构建、部署与在线检查](https://github.com/weidadedawei/architecture-studio/actions/runs/39214296614)。后续每次更新请以对应提交的 Actions 结果为准。

## 1. 创建自己的在线演示

1. Fork 本仓库，保留仓库名 `architecture-studio`，或将代码放入自己的公开仓库。
2. 在仓库的 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**。
3. 打开 **Actions → Test and deploy GitHub Pages → Run workflow**，选择 `main` 执行。后续推送到 `main` 会自动触发同一流程。若 Fork 后工作流被停用，先按 GitHub 页面提示启用。
4. 查看运行记录中的 `build` 与 `deploy` 作业。部署地址也会显示在 `github-pages` 环境和部署步骤中。

自己的项目地址通常为 `https://用户名.github.io/仓库名/`。发布权限由工作流的最小权限配置提供，无需把个人 Token 写入代码。

## 2. 发布前在本地检查

使用 Python 3.10 或更新版本，在仓库根目录执行：

```bash
python3 tests/static_check.py --report reports/static-check-report.json
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/prepare_web.py
python3 -m http.server 8088 --bind 127.0.0.1 --directory web-dist
```

打开 `http://127.0.0.1:8088/` 演练。前两条命令分别执行 **13 组静态检查、16 项检查器回归测试**；构建脚本生成 `web-dist/`，包含网页、图片、操作实例、下载 ZIP 和静态部署标记。基础流程仅使用 Python 标准库。

## 3. 在线测试如何确认版本

工作流先检查、再构建，随后发布 `web-dist/`。部署完成后运行 **15 项 HTTP 检查**，覆盖编辑器、教程、图片、实例、ZIP 下载、静态标记及真实 404。

构建时，`health.json` 的 `sourceCommit` 记录本次 `GITHUB_SHA`；在线检查使用 `--expected-commit` 比较该值，防止 CDN 尚未更新时把旧页面记为本次通过。检查失败会有限重试，仍失败则作业报错。

在 Actions 运行详情下载 `github-pages-http-verification` artifact，可查看 JSON 报告。需要手动复核时，把下列占位符换成本次完整提交 SHA：

```bash
python3 tests/http_smoke.py \
  --base-url https://weidadedawei.github.io/architecture-studio/ \
  --expected-commit 完整提交SHA \
  --report reports/github-pages-http-smoke.json
```

HTTP 通过只说明公开资源和提交标记符合检查条件。还应在浏览器实测切换双图、中英文编辑、拖拽、撤销、JSON 导入和 PNG/SVG/Draw.io 下载。

## 4. 后续修改与子路径

编辑 `demo/source/` 或 `demo/diagram-project.json` 后，运行 `python3 demo/source/rebuild.py` 更新独立网页。在线教程维护在 `web/guide.html`、`web/deploy.html`；博客正文单独维护在 Markdown 中。提交这些源文件后推送 `main`，由 Actions 重新构建，勿提交生成目录、缓存或真实业务数据。

项目站点必须保留 `/architecture-studio/` 前缀及末尾斜杠。普通页面使用相对资源路径；`web/404.html` 的返回链接使用带仓库前缀的绝对路径，避免在深层错误地址中跳错。更换仓库名时同步修改这些链接、教程地址和验收命令。不要将未知路径统一回退为 HTTP 200 的首页，否则真实 404 检查会失败。

浏览器中的修改仅保存在当前浏览器，不会自动写回 GitHub。请先导出 JSON 或独立 HTML 备份；需要更新公共默认图稿时，再将 JSON 纳入源码并重新发布。

流程依据：[GitHub Pages 自定义工作流官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
