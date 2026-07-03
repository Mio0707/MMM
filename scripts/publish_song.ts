import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

type Args = Record<string, string | boolean>;

type ParsedLyric = {
  line_index: number;
  original_ko: string;
  start_time: number;
  end_time: number | null;
};

const BUCKET = 'kpop-project data';

function parseArgs(values: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function required(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required argument: --${key}`);
  }
  return value;
}

function readFile(filePath: string): Buffer {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return fs.readFileSync(resolved);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function parseLrc(content: string): ParsedLyric[] {
  const parsed: Omit<ParsedLyric, 'end_time'>[] = [];
  const timestamp = /^\[(\d{1,3}):(\d{2})[.:](\d{2,3})\](.*)$/;

  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = rawLine.trim().match(timestamp);
    if (!match) continue;
    const fraction = Number(match[3]) / (match[3].length === 3 ? 1000 : 100);
    const text = match[4].trim();
    if (!text) continue;
    parsed.push({
      line_index: parsed.length + 1,
      original_ko: text,
      start_time: Number(match[1]) * 60 + Number(match[2]) + fraction,
    });
  }

  return parsed.map((line, index) => ({
    ...line,
    end_time: parsed[index + 1]?.start_time ?? null,
  }));
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  return types[extension] || 'application/octet-stream';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const songId = required(args, 'id');
  const songName = required(args, 'name');
  const audioPath = required(args, 'audio');
  const lyricsPath = required(args, 'lyrics');
  const analysisPath = required(args, 'analysis');
  const coverPath = typeof args.cover === 'string' ? args.cover : '';
  const apply = args.apply === true;

  const audio = readFile(audioPath);
  const lrc = readFile(lyricsPath).toString('utf8');
  const analysis = JSON.parse(readFile(analysisPath).toString('utf8'));
  if (analysis.song_id !== songId) {
    throw new Error(`analysis song_id must be "${songId}"`);
  }

  const lyricLines = parseLrc(lrc);
  if (!lyricLines.length) throw new Error('No timestamped lyric lines found in the LRC file.');

  const indexesByText = new Map<string, number[]>();
  for (const line of lyricLines) {
    const key = normalizeText(line.original_ko);
    indexesByText.set(key, [...(indexesByText.get(key) || []), line.line_index]);
  }

  const usedIndexes = new Set<number>();
  const sourceIndexMap = new Map<number, number>();
  const lineAnalyses = (analysis.line_analyses || []).map((line: any) => {
    const original = line.original_text || line.original_ko;
    const candidates = indexesByText.get(normalizeText(original || '')) || [];
    const fullIndex = candidates.find((candidate) => !usedIndexes.has(candidate));
    if (!original || !fullIndex) {
      throw new Error(`Analysis line could not be matched to the LRC: ${original || '(empty)'}`);
    }
    usedIndexes.add(fullIndex);
    sourceIndexMap.set(Number(line.line_index), fullIndex);
    return {
      ...line,
      line_index: fullIndex,
      original_ko: original,
    };
  });

  const words = (analysis.words || []).map((word: any) => ({
    ...word,
    source_line_indexes: (word.source_line_indexes || []).map((index: number) => {
      const mapped = sourceIndexMap.get(Number(index));
      if (!mapped) throw new Error(`Word source line ${index} could not be mapped.`);
      return mapped;
    }),
  }));

  console.log(JSON.stringify({
    mode: apply ? 'publish' : 'check-only',
    songId,
    songName,
    cover: coverPath || '(empty)',
    lyricLines: lyricLines.length,
    analysisLines: lineAnalyses.length,
    words: words.length,
  }, null, 2));

  if (!apply) {
    console.log('Check passed. Add --apply to publish.');
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const relatedTables = ['lyric_line_analysis', 'lyric_words', 'lyric_lines'];
  const { count: songCount, error: songCheckError } = await supabase
    .from('songs')
    .select('*', { count: 'exact', head: true })
    .eq('songId', songId);
  if (songCheckError) throw songCheckError;
  if (songCount) throw new Error(`Song already exists: ${songId}`);

  for (const table of relatedTables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('song_id', songId);
    if (error) throw error;
    if (count) throw new Error(`Existing ${table} records found for ${songId}`);
  }

  const uploadedPaths: string[] = [];
  try {
    const audioObjectPath = `music/${songId}${path.extname(audioPath).toLowerCase()}`;
    const { error: audioError } = await supabase.storage
      .from(BUCKET)
      .upload(audioObjectPath, audio, { contentType: contentType(audioPath), upsert: false });
    if (audioError) throw audioError;
    uploadedPaths.push(audioObjectPath);
    const audioUrl = supabase.storage.from(BUCKET).getPublicUrl(audioObjectPath).data.publicUrl;

    let coverUrl = '';
    if (coverPath) {
      const coverObjectPath = `cover/${songId}${path.extname(coverPath).toLowerCase()}`;
      const { error: coverError } = await supabase.storage
        .from(BUCKET)
        .upload(coverObjectPath, readFile(coverPath), {
          contentType: contentType(coverPath),
          upsert: false,
        });
      if (coverError) throw coverError;
      uploadedPaths.push(coverObjectPath);
      coverUrl = supabase.storage.from(BUCKET).getPublicUrl(coverObjectPath).data.publicUrl;
    }

    const { data: insertedLyricLines, error: lyricError } = await supabase
      .from('lyric_lines')
      .insert(lyricLines.map((line) => ({ song_id: songId, ...line })))
      .select('id,line_index');
    if (lyricError) throw lyricError;

    const lyricLineIds = new Map<number, string>(
      (insertedLyricLines || []).map((line: any) => [Number(line.line_index), line.id]),
    );

    const { error: analysisError } = await supabase.from('lyric_line_analysis').insert(
      lineAnalyses.map((line: any) => ({
        song_id: songId,
        lyric_line_id: lyricLineIds.get(line.line_index) || null,
        line_index: line.line_index,
        original_ko: line.original_ko,
        natural_translation_zh: line.natural_translation_zh,
        literal_translation_zh: line.literal_translation_zh,
        word_breakdown_json: line.word_breakdown || line.word_breakdown_json || [],
        grammar_note_zh: line.grammar_note_zh || '',
        level: line.level || 'L1',
        priority_score: line.priority_score || 0,
        tts_text: line.tts_text || line.original_ko,
      })),
    );
    if (analysisError) throw analysisError;

    const { error: wordsError } = await supabase.from('lyric_words').insert(
      words.map((word: any) => ({
        song_id: songId,
        surface_form: word.surface_form,
        lemma: word.lemma || word.surface_form,
        meaning_zh: word.meaning_zh,
        pronunciation: word.pronunciation || null,
        part_of_speech: word.part_of_speech,
        level: word.level || 'L1',
        frequency_in_song: word.frequency_in_song || 1,
        source_line_ids: word.source_line_indexes
          .map((index: number) => lyricLineIds.get(index))
          .filter(Boolean),
        source_line_indexes: word.source_line_indexes,
        priority_score: word.priority_score || 0,
        tts_text: word.tts_text || word.surface_form,
      })),
    );
    if (wordsError) throw wordsError;

    const { error: songError } = await supabase.from('songs').insert({
      songId,
      songName,
      coverImg: coverUrl,
      audiourl: audioUrl,
      lyrics: lrc,
    });
    if (songError) throw songError;

    console.log(`Published successfully: ${songName} (${songId})`);
  } catch (error) {
    await supabase.from('songs').delete().eq('songId', songId);
    await supabase.from('lyric_line_analysis').delete().eq('song_id', songId);
    await supabase.from('lyric_words').delete().eq('song_id', songId);
    await supabase.from('lyric_lines').delete().eq('song_id', songId);
    if (uploadedPaths.length) await supabase.storage.from(BUCKET).remove(uploadedPaths);
    throw error;
  }
}

main().catch((error: any) => {
  console.error(`ERROR: ${error.message || error}`);
  process.exit(1);
});
