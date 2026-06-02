import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('==================================================');
console.log('     K-POP Batch Analysis Importer (Folder-Based) ');
console.log('==================================================');

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('ERROR: Missing database config variables.');
  console.error('Please define VITE_SUPABASE_URL or SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function normalizePayload(payload: any) {
  return {
    songId: payload.song_id,
    lyricLines: payload.lyric_lines || [],
    lineAnalyses: payload.line_analyses || payload.lyric_line_analysis || [],
    words: payload.words || payload.lyric_words || []
  };
}

async function importSingleFile(filePath: string): Promise<boolean> {
  const fileName = path.basename(filePath);
  console.log(`\n--------------------------------------------------`);
  console.log(`Processing file: [${fileName}]`);

  const rawData = fs.readFileSync(filePath, 'utf8');
  let analysisData: any;
  try {
    analysisData = JSON.parse(rawData);
  } catch (err: any) {
    console.error(`  ❌ ERROR: Failed to parse ${fileName}. Error: ${err.message}`);
    return false;
  }

  const { songId, lyricLines, lineAnalyses, words } = normalizePayload(analysisData);

  if (!songId) {
    console.error(`  ❌ ERROR: Missing 'song_id' in ${fileName}.`);
    return false;
  }

  console.log(`  Identified Song ID: "${songId}"`);
  console.log(`  lyric_lines: ${lyricLines.length}`);
  console.log(`  line analyses: ${lineAnalyses.length}`);
  console.log(`  vocabulary words: ${words.length}`);

  // Clear analysis tables first to avoid FK conflicts.
  const { error: clearAnalysesError } = await supabase
    .from('lyric_line_analysis')
    .delete()
    .eq('song_id', songId);

  if (clearAnalysesError) {
    console.error(`  ❌ Error clearing lyric_line_analysis: ${clearAnalysesError.message}`);
    return false;
  }

  const { error: clearWordsError } = await supabase
    .from('lyric_words')
    .delete()
    .eq('song_id', songId);

  if (clearWordsError) {
    console.error(`  ❌ Error clearing lyric_words: ${clearWordsError.message}`);
    return false;
  }

  // Optional raw lyric_lines import.
  if (Array.isArray(lyricLines) && lyricLines.length > 0) {
    const { error: clearRawLinesError } = await supabase
      .from('lyric_lines')
      .delete()
      .eq('song_id', songId);

    if (clearRawLinesError) {
      console.warn(`  ⚠️ Could not clear lyric_lines: ${clearRawLinesError.message}`);
      console.warn('  Continuing; lyric_line_id may remain NULL.');
    } else {
      const finalRawLines = lyricLines.map((line: any) => ({
        song_id: songId,
        line_index: line.line_index,
        original_ko: line.original_ko,
        start_time: line.start_time ?? 0,
        end_time: line.end_time ?? null
      }));

      const { error: insertRawLinesError } = await supabase
        .from('lyric_lines')
        .insert(finalRawLines);

      if (insertRawLinesError) {
        console.error(`  ❌ DB Write Failed for lyric_lines: ${insertRawLinesError.message}`);
        return false;
      }
      console.log(`  ✔ lyric_lines saved successfully.`);
    }
  }

  const { data: lyricLineRows, error: fetchLinesError } = await supabase
    .from('lyric_lines')
    .select('id, line_index, original_ko')
    .eq('song_id', songId);

  const lyricLinesMap = new Map<number, string>();
  if (fetchLinesError) {
    console.warn(`  ⚠️ Could not fetch lyric_lines: ${fetchLinesError.message}`);
  } else if (lyricLineRows && lyricLineRows.length > 0) {
    lyricLineRows.forEach((line: any) => lyricLinesMap.set(line.line_index, line.id));
    console.log(`  Mapped ${lyricLineRows.length} lyric_lines rows.`);
  } else {
    console.warn(`  ⚠️ No lyric_lines found for song_id "${songId}". lyric_line_id will be NULL.`);
  }

  if (lineAnalyses.length > 0) {
    const finalLines = lineAnalyses.map((line: any) => {
      const lineIndex = line.line_index;
      return {
        song_id: songId,
        lyric_line_id: lyricLinesMap.get(lineIndex) || null,
        line_index: lineIndex,
        original_ko: line.original_ko,
        natural_translation_zh: line.natural_translation_zh,
        literal_translation_zh: line.literal_translation_zh,
        word_breakdown_json: line.word_breakdown || line.word_breakdown_json || [],
        grammar_note_zh: line.grammar_note_zh || '',
        level: line.level || 'L1',
        priority_score: line.priority_score || 0,
        tts_text: line.tts_text || line.original_ko
      };
    });

    const { error: insertLinesError } = await supabase
      .from('lyric_line_analysis')
      .insert(finalLines);

    if (insertLinesError) {
      console.error(`  ❌ DB Write Failed for lyric_line_analysis: ${insertLinesError.message}`);
      return false;
    }
    console.log(`  ✔ lyric_line_analysis saved successfully.`);
  }

  if (words.length > 0) {
    const finalWords = words.map((word: any) => {
      const sourceLineIndexes = word.source_line_indexes || [];
      const sourceLineIds = sourceLineIndexes
        .map((idx: number) => lyricLinesMap.get(idx))
        .filter(Boolean);

      return {
        song_id: songId,
        surface_form: word.surface_form,
        lemma: word.lemma || word.surface_form,
        meaning_zh: word.meaning_zh,
        pronunciation: word.pronunciation || null,
        part_of_speech: word.part_of_speech,
        level: word.level || 'L1',
        frequency_in_song: word.frequency_in_song || 1,
        source_line_ids: sourceLineIds,
        source_line_indexes: sourceLineIndexes,
        priority_score: word.priority_score || 0,
        tts_text: word.tts_text || word.surface_form
      };
    });

    const { error: insertWordsError } = await supabase
      .from('lyric_words')
      .insert(finalWords);

    if (insertWordsError) {
      console.error(`  ❌ DB Write Failed for lyric_words: ${insertWordsError.message}`);
      return false;
    }
    console.log(`  ✔ lyric_words saved successfully.`);
  }

  console.log(`  🎉 Finished importing song: "${songId}"`);
  return true;
}

async function run() {
  const dataDir = path.join(process.cwd(), 'analysis_data');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
    console.log(`Created folder: ${dataDir}`);
    console.log('Put your generated JSON files inside /analysis_data/ and run again.');
    return;
  }

  const files = fs.readdirSync(dataDir).filter(f => f.toLowerCase().endsWith('.json'));
  if (files.length === 0) {
    console.log('No JSON files found in /analysis_data/.');
    return;
  }

  let successCount = 0;
  for (const file of files) {
    const ok = await importSingleFile(path.join(dataDir, file));
    if (ok) successCount++;
  }

  console.log(`\nBATCH FINISHED: Imported ${successCount}/${files.length} files successfully.`);
}

run().catch((err: any) => {
  console.error('Critical error in batch runner:', err);
  process.exit(1);
});
