# Architecture Studio

一个可以直接在线使用，也可以离线保存的中英文架构图编辑器。所有业务、设备、端口和云网络示例均为虚构教学数据。

- [在线编辑器](https://weidadedawei.github.io/architecture-studio/)
- [完整教程](https://weidadedawei.github.io/architecture-studio/guide.html)
- [部署与在线验收](https://weidadedawei.github.io/architecture-studio/deploy.html)
- [CSDN 博客正文](CSDN博客正文.md)

## 功能

系统技术架构、网络拓扑两张独立图稿，中文和English共用布局；支持编辑组件、分区、文字、图标、连线、撤销重做、JSON导入保存、独立HTML保存，以及PNG/SVG/Draw.io导出。编辑器在访问者自己的浏览器运行，没有共享项目后端。

## 本地运行与测试

直接打开 `demo/index.html`，或生成静态部署目录：

```bash
python3 scripts/prepare_web.py
python3 -m http.server 8088 --bind 127.0.0.1 --directory web-dist
```

Python 3.10+，基础静态检查不需要安装依赖：

```bash
python3 tests/static_check.py --report reports/static-check-report.json
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

扩展离线功能测试使用 Node.js 20.9+：

```bash
npm ci
npm test
npm run render
```

## 自动部署 GitHub Pages

仓库 Pages Source 为 GitHub Actions。推送到 `main` 后，`.github/workflows/pages.yml` 依次执行静态检查、检查器正负例测试、构建静态目录、部署Pages，以及公开链接HTTP检查。部署流程使用最小所需的 `contents: read`、`pages: write`、`id-token: write` 权限；检查结果随 Actions 日志和报告 artifact 保存。

后续修改 `demo/source/` 或默认数据时，先运行 `python3 demo/source/rebuild.py`；修改在线教程时同步维护 `web/guide.html`、`web/deploy.html`。推送后由工作流重新生成 `web-dist/`，不要提交本机缓存和生成目录。

[Pages 发布工作流官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。图标许可见 `demo/licenses/lucide-LICENSE`。
