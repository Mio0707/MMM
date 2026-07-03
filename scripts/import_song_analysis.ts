import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

function requiredArg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : '';
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function assertWordBreakdown(line: any) {
  const original = line.original_text || line.original_ko || `line ${line.line_index}`;
  const breakdown = line.word_breakdown;
  if (!Array.isArray(breakdown) || breakdown.length === 0) {
    throw new Error(`Missing word_breakdown for analysis line: ${original}`);
  }
  const requiredFields = ['surface', 'lemma', 'meaning_zh', 'part_of_speech', 'level', 'pronunciation'];
  for (const [index, word] of breakdown.entries()) {
    for (const field of requiredFields) {
      if (!String(word?.[field] || '').trim()) {
        throw new Error(`Missing word_breakdown.${field} for "${original}" item ${index + 1}.`);
      }
    }
  }
}

async function main() {
  const file = path.resolve(requiredArg('file'));
  const apply = process.argv.includes('--apply');
  const updateLiterals = process.argv.includes('--update-literals');
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const songId = payload.song_id;
  if (!songId) throw new Error('Missing song_id.');

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Missing database configuration.');
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: rawLines, error: rawError } = await supabase
    .from('lyric_lines')
    .select('id,line_index,original_ko')
    .eq('song_id', songId)
    .order('line_index');
  if (rawError) throw rawError;
  if (!rawLines?.length) throw new Error(`No lyric lines found for ${songId}.`);

  const firstByText = new Map<string, any>();
  for (const line of rawLines) {
    const key = normalize(line.original_ko);
    if (!firstByText.has(key)) firstByText.set(key, line);
  }

  const studyToFull = new Map<number, number>();
  const analyses = payload.line_analyses.map((line: any) => {
    assertWordBreakdown(line);
    const original = line.original_text || line.original_ko;
    const rawLine = firstByText.get(normalize(original || ''));
    if (!rawLine) throw new Error(`Analysis line not found in lyrics: ${original}`);
    studyToFull.set(Number(line.line_index), Number(rawLine.line_index));
    return {
      song_id: songId,
      lyric_line_id: rawLine.id,
      line_index: rawLine.line_index,
      original_ko: original,
      natural_translation_zh: line.natural_translation_zh,
      literal_translation_zh: line.literal_translation_zh,
      word_breakdown_json: line.word_breakdown || [],
      grammar_note_zh: line.grammar_note_zh,
      level: line.level,
      priority_score: line.priority_score,
      tts_text: line.tts_text,
    };
  });

  const words = payload.words.map((word: any) => {
    const fullIndexes = word.source_line_indexes.map((index: number) => {
      const full = studyToFull.get(Number(index));
      if (!full) throw new Error(`Unknown source line ${index} for ${word.surface_form}.`);
      return full;
    });
    const sourceIds = fullIndexes.map((index: number) => rawLines.find((line: any) => Number(line.line_index) === index)?.id).filter(Boolean);
    return {
      song_id: songId,
      surface_form: word.surface_form,
      lemma: word.lemma,
      meaning_zh: word.meaning_zh,
      pronunciation: word.pronunciation,
      part_of_speech: word.part_of_speech,
      level: word.level,
      frequency_in_song: word.frequency_in_song,
      source_line_ids: sourceIds,
      source_line_indexes: fullIndexes,
      priority_score: word.priority_score,
      tts_text: word.tts_text,
    };
  });

  if (updateLiterals) {
    const { data: existingAnalyses, error: existingError } = await supabase
      .from('lyric_line_analysis')
      .select('id,lyric_line_id')
      .eq('song_id', songId);
    if (existingError) throw existingError;
    if (existingAnalyses?.length !== analyses.length) {
      throw new Error(`Expected ${analyses.length} existing analyses, found ${existingAnalyses?.length || 0}.`);
    }
    console.log(JSON.stringify({ mode: apply ? 'update-literals' : 'check-literals', songId, analyses: analyses.length }, null, 2));
    if (!apply) {
      console.log('Check passed. Add --apply to update literal translations.');
      return;
    }
    for (const analysis of analyses) {
      const { error: updateError } = await supabase
        .from('lyric_line_analysis')
        .update({ literal_translation_zh: analysis.literal_translation_zh })
        .eq('song_id', songId)
        .eq('lyric_line_id', analysis.lyric_line_id);
      if (updateError) throw updateError;
    }
    console.log(`Updated literal translations for ${songId}.`);
    return;
  }

  for (const table of ['lyric_line_analysis', 'lyric_words']) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('song_id', songId);
    if (error) throw error;
    if (count) throw new Error(`${table} already contains ${count} rows for ${songId}.`);
  }

  console.log(JSON.stringify({ mode: apply ? 'import' : 'check-only', songId, analyses: analyses.length, words: words.length }, null, 2));
  if (!apply) {
    console.log('Check passed. Add --apply to import.');
    return;
  }

  const { error: analysisError } = await supabase.from('lyric_line_analysis').insert(analyses);
  if (analysisError) throw analysisError;
  const { error: wordError } = await supabase.from('lyric_words').insert(words);
  if (wordError) {
    await supabase.from('lyric_line_analysis').delete().eq('song_id', songId);
    throw wordError;
  }
  console.log(`Imported analysis for ${songId}.`);
}

main().catch((error: any) => {
  console.error(`ERROR: ${error.message || error}`);
  process.exit(1);
});
