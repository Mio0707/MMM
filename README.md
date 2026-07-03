# K-Pop Chant Lab

## Song Data Workflow

新增歌曲、制作歌词学习解析、上线后质检和修复，请遵循 `docs/song-data-workflow.md`。这份流程是当前项目的歌曲数据标准，重点约束歌词清洗、逐句解析、逐词拆解、核心单词、等级格式和上线后质检。

如果要在其他本地项目中复用歌词分析流程，不使用 Supabase，参考 `docs/reusable-lyric-analysis-standard.md`。这份文档只保留可迁移的数据结构、制作规范、质检清单和 AI 生成提示词。

状态：已上线

线上地址：[www.mmmstarrynight.cn](http://www.mmmstarrynight.cn/)

代码仓库：[Mio0707/MMM](https://github.com/Mio0707/MMM)

## 产品简介

K-Pop Chant Lab 是一个面向 K-Pop 学习者和粉丝的网页产品。用户可以选择歌曲，学习歌词中的韩语，也可以跟随原曲练习应援口号。

## 当前功能

- 歌曲浏览与搜索。
- 歌词学习和应援口号两种入口。
- L1 至 L4 难度筛选。
- 核心单词、意译、直译、逐词拆解和语法说明。
- 完整歌词跟听、播放进度同步和当前句原曲回放。
- 应援时间点提示、输入练习、提示信息和完成结果。
- 电脑和手机页面适配。

## 内容来源

网页从 Supabase 读取歌曲、歌词、应援内容和歌词分析资料。项目运行需要正确配置以下环境变量：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

批量导入或自动生成学习资料时还会使用：

```text
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
```

不要公开 `.env` 文件，也不要把管理权限密钥放进网页代码或提交到代码仓库。

## 本地运行

```bash
npm install
npm run dev
```

默认打开：`http://127.0.0.1:3000`

## 发布前检查

```bash
npm run lint
npm run build
```

生成的发布文件位于 `dist/`。

## 更新歌词学习资料

单个资料文件使用项目根目录的 `analysis.json`：

```bash
npx tsx scripts/import_analysis.ts
```

批量资料文件放入 `analysis_data/`，格式说明见 [`analysis_data/README.md`](analysis_data/README.md)：

```bash
npx tsx scripts/batch_import_analysis.ts
```

这些操作会修改线上内容库，执行前应确认歌曲编号和目标环境正确，并提前保留原有资料。

## 主要目录

```text
CHE-v1/
├─ src/                 网页主体
├─ public/              网页使用的公开素材
├─ scripts/             歌词分析生成与导入工具
├─ analysis_data/       等待批量导入的学习资料
├─ dist/                发布成品
├─ .env.example         环境变量示例
└─ README.md            本说明
```

## 与 SKILL 项目的关系

`CHE-v1` 是已经上线的正式产品。工作区中的 `good-goodbye-local-site/` 和 `skills/kpop-local-lyrics/` 属于另一个仍在制作中的 SKILL，不是 `CHE-v1` 的线上发布目录。
