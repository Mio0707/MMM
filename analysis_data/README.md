# K-POP 歌词分析数据文件夹

本文件夹用于存放等待导入当前网站的歌词分析 JSON 文件。

制作数据前请先阅读：

- 当前网站上线流程：`docs/song-data-workflow.md`
- 可复用本地项目规范：`docs/reusable-lyric-analysis-standard.md`

## 批量导入

确认 `.env` 中已配置管理权限密钥后，在项目根目录运行：

```bash
npx tsx scripts/batch_import_analysis.ts
```

这些操作会修改线上内容。执行前必须确认歌曲编号和目标环境正确。

## JSON 结构示例

每首歌一个 JSON 文件：

```json
{
  "song_id": "song-slug",
  "line_analyses": [
    {
      "line_index": 1,
      "original_ko": "저녁 노을 하늘을 바라보면",
      "natural_translation_zh": "当我望向映着晚霞的天空",
      "literal_translation_zh": "저녁=傍晚 / 노을=晚霞 / 하늘을=天空-宾格 / 바라보면=望着时",
      "word_breakdown": [
        {
          "surface": "저녁",
          "lemma": "저녁",
          "meaning_zh": "傍晚",
          "part_of_speech": "名词",
          "level": "L1",
          "pronunciation": "jeo-nyeok"
        },
        {
          "surface": "노을",
          "lemma": "노을",
          "meaning_zh": "晚霞",
          "part_of_speech": "名词",
          "level": "L2",
          "pronunciation": "no-eul"
        },
        {
          "surface": "바라보면",
          "lemma": "바라보다",
          "meaning_zh": "望着时",
          "part_of_speech": "动词活用",
          "level": "L2",
          "pronunciation": "ba-ra-bo-myeon"
        }
      ],
      "grammar_note_zh": "`-(으)면` 表示“如果……/当……时”，这里接在 `바라보다` 后，表达“当望向天空时”。",
      "level": "L2",
      "priority_score": 90,
      "tts_text": "저녁 노을 하늘을 바라보면"
    }
  ],
  "words": [
    {
      "surface_form": "저녁",
      "lemma": "저녁",
      "meaning_zh": "傍晚",
      "part_of_speech": "名词",
      "level": "L1",
      "pronunciation": "jeo-nyeok",
      "frequency_in_song": 1,
      "source_line_indexes": [1],
      "priority_score": 80,
      "tts_text": "저녁"
    }
  ]
}
```

## 强制质量要求

- `natural_translation_zh` 必须重新翻译，不使用歌词文件自带中文。
- `literal_translation_zh` 必须按韩语词序解释，不写成自然中文句子。
- 有韩文的句子，`word_breakdown` 不允许为空。
- 逐词拆解和核心单词都必须包含 `pronunciation`。
- `level` 只允许 `L1`、`L2`、`L3`、`L4`。
- `grammar_note_zh` 有真实语法点才写；没有语法点就留空。
- 不允许用“这句适合整体理解”“先抓核心词”“没有明显语法点”等套话填充文法详解。
- 不要把词内部音节误判成语法点。
