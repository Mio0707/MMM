import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('=== K-POP Lyric Analysis Importer ===');

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('ERROR: Missing database configuration variables.');
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

async function run() {
  const jsonPath = path.join(process.cwd(), 'analysis.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`ERROR: Please place your analysis.json file at: ${jsonPath}`);
    process.exit(1);
  }

  console.log(`Reading file: ${jsonPath}`);
  const rawData = fs.readFileSync(jsonPath, 'utf8');

  let analysisData: any;
  try {
    analysisData = JSON.parse(rawData);
  } catch (err: any) {
    console.error('ERROR: Failed to parse analysis.json. Check JSON syntax.', err.message);
    process.exit(1);
  }

  const { songId, lyricLines, lineAnalyses, words } = normalizePayload(analysisData);

  if (!songId) {
    console.error("ERROR: 'song_id' is missing in analysis.json.");
    process.exit(1);
  }

  console.log(`Processing song: "${songId}"`);
  console.log(`Detected lyric_lines: ${lyricLines.length}`);
  console.log(`Detected line analyses: ${lineAnalyses.length}`);
  console.log(`Detected vocabulary words: ${words.length}`);

  // Clear analysis tables first. This avoids FK conflicts if lyric_line_analysis references lyric_lines.
  console.log(`Clearing old lyric_line_analysis and lyric_words entries for song_id: "${songId}"...`);

  const { error: clearAnalysesError } = await supabase
    .from('lyric_line_analysis')
    .delete()
    .eq('song_id', songId);

  if (clearAnalysesError) {
    console.error(`ERROR clearing lyric_line_analysis: ${clearAnalysesError.message}`);
    process.exit(1);
  }

  const { error: clearWordsError } = await supabase
    .from('lyric_words')
    .delete()
    .eq('song_id', songId);

  if (clearWordsError) {
    console.error(`ERROR clearing lyric_words: ${clearWordsError.message}`);
    process.exit(1);
  }

  // Optional: import raw lyric_lines if present in JSON.
  if (Array.isArray(lyricLines) && lyricLines.length > 0) {
    console.log(`Importing ${lyricLines.length} raw lyric_lines...`);

    const { error: clearRawLinesError } = await supabase
      .from('lyric_lines')
      .delete()
      .eq('song_id', songId);

    if (clearRawLinesError) {
      console.warn(`WARNING: Could not clear lyric_lines: ${clearRawLinesError.message}`);
      console.warn('Continuing. If lyric_lines cannot be read, lyric_line_id will be NULL.');
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
        console.error(`ERROR inserting lyric_lines: ${insertRawLinesError.message}`);
        process.exit(1);
      }
      console.log(`Inserted ${finalRawLines.length} lyric_lines successfully.`);
    }
  }

  // Fetch lyric_lines after optional import, so line_index can be mapped to lyric_line_id.
  const { data: lyricLineRows, error: fetchLinesError } = await supabase
    .from('lyric_lines')
    .select('id, line_index, original_ko')
    .eq('song_id', songId);

  const lyricLinesMap = new Map<number, string>();
  if (fetchLinesError) {
    console.warn(`WARNING: Could not fetch lyric_lines: ${fetchLinesError.message}`);
    console.warn('line_analyses will be inserted with lyric_line_id = NULL.');
  } else if (lyricLineRows && lyricLineRows.length > 0) {
    lyricLineRows.forEach((line: any) => lyricLinesMap.set(line.line_index, line.id));
    console.log(`Mapped ${lyricLineRows.length} lyric_lines rows.`);
  } else {
    console.warn(`WARNING: No lyric_lines found for song_id "${songId}". lyric_line_id will be NULL.`);
  }

  if (lineAnalyses.length > 0) {
    const finalLineAnalyses = lineAnalyses.map((line: any) => {
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

    const { data: insertedLines, error: insertLinesError } = await supabase
      .from('lyric_line_analysis')
      .insert(finalLineAnalyses)
      .select();

    if (insertLinesError) {
      console.error(`ERROR inserting lyric_line_analysis: ${insertLinesError.message}`);
      process.exit(1);
    }
    console.log(`Inserted ${insertedLines?.length || finalLineAnalyses.length} lyric_line_analysis records.`);
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

    const { data: insertedWords, error: insertWordsError } = await supabase
      .from('lyric_words')
      .insert(finalWords)
      .select();

    if (insertWordsError) {
      console.error(`ERROR inserting lyric_words: ${insertWordsError.message}`);
      process.exit(1);
    }
    console.log(`Inserted ${insertedWords?.length || finalWords.length} lyric_words records.`);
  }

  console.log('\n=== IMPORT COMPLETE ===');
}

run().catch((err: any) => {
  console.error('Unhandled error running script:', err);
  process.exit(1);
});
