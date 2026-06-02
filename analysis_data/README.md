# K-POP AI 歌词分析数据文件夹 (K-POP Live AI Analysis Data)

请将你用外部 AI 生成的所有歌曲的歌词分析 JSON 文件放入当前文件夹下（例如 `hip.json`, `dingga.json`, `gogobebe.json`）。

### 📂 运行批量导入命令：
确保在根目录下的 `.env` 文件中配置好了 `SUPABASE_SERVICE_ROLE_KEY` 变量，然后在终端或工作区运行以下命令：

```bash
npx tsx scripts/batch_import_analysis.ts
```

### 🗒 JSON 文件数据结构模板示例：
每个 JSON 文件应该具有如下的独立对象结构：

```json
{
  "song_id": "你的歌cd-id(例如: hip-001)",
  "line_analyses": [
    {
      "line_index": 1,
      "original_ko": "All I wanna be is cool",
      "natural_translation_zh": "我只想变得酷炫",
      "literal_translation_zh": "所有我想要成为的是酷",
      "word_breakdown": [
        {
          "surface": "All",
          "lemma": "All",
          "meaning_zh": "所有",
          "part_of_speech": "pronoun",
          "level": "L1"
        }
      ],
      "grammar_note_zh": "全英文句，表达自信的态度。",
      "level": "L1",
      "priority_score": 90,
      "tts_text": "All I wanna be is cool"
    }
  ],
  "words": [
    {
      "surface_form": "세상",
      "lemma": "세상",
      "meaning_zh": "世界",
      "part_of_speech": "noun",
      "level": "L1",
      "frequency_in_song": 1,
      "source_line_indexes": [1],
      "priority_score": 90,
      "tts_text": "세상"
    }
  ]
}
```
