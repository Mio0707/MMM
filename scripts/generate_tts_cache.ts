import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_VOICE = 'ko-KR-SunHiNeural';
const BUCKET = 'tts-cache';
const ANALYSIS_DIR = path.resolve('analysis_data');

function argValue(name: string, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function hasArg(name: string) {
  return process.argv.includes(`--${name}`);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function hasKorean(value: string) {
  return /[\uac00-\ud7a3]/.test(value);
}

function parseMaybeJson(value: string) {
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectTtsTexts(value: unknown, output: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTtsTexts(item, output));
    return;
  }

  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      ['tts_text', 'original_text', 'original_ko', 'surface', 'surface_form', 'lemma'].includes(key) &&
      typeof child === 'string'
    ) {
      const text = normalizeText(child);
      if (text && hasKorean(text)) output.add(text);
    }

    if (typeof child === 'string' && key.endsWith('_json')) {
      const parsed = parseMaybeJson(child);
      if (parsed) collectTtsTexts(parsed, output);
    }

    collectTtsTexts(child, output);
  }
}

function readLocalTexts() {
  const texts = new Set<string>();
  const files = fs.readdirSync(ANALYSIS_DIR).filter((file) => file.endsWith('.json'));

  for (const file of files) {
    const fullPath = path.join(ANALYSIS_DIR, file);
    const payload = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    collectTtsTexts(payload, texts);
  }

  return [...texts].sort((a, b) => a.localeCompare(b, 'ko'));
}

async function fetchAllRows(supabase: any, table: string, select = '*') {
  const rows: any[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(table).select(select).range(from, to);
    if (error) throw error;

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function readSupportPointTexts(supabase: any, existingRows?: any[]) {
  const texts = new Set<string>();
  const rows = existingRows || await fetchAllRows(supabase, 'support_points');

  for (const point of rows || []) {
    if (typeof point.chant === 'string') {
      const lines = point.chant.split(/\r?\n/).filter((line: string) => line.trim());
      for (const line of lines) {
        const match = line.match(/^\s*\[(?:(\d+):)?([\d.]+)\](.*)$/);
        if (!match) continue;
        const text = normalizeText(match[3].split('::')[0] || '');
        if (text && hasKorean(text)) texts.add(text);
      }
    }

    const textList = Array.isArray(point.textList)
      ? point.textList
      : Array.isArray(point.text_list)
        ? point.text_list
        : point.text
          ? [point.text]
          : [];

    const joinedText = normalizeText(textList.join(' '));
    if (joinedText && hasKorean(joinedText)) texts.add(joinedText);
  }

  return [...texts];
}

async function readDatabaseTexts(supabase: any) {
  const texts = new Set<string>();
  const [analysisRows, wordRows, supportPointRows] = await Promise.all([
    fetchAllRows(supabase, 'lyric_line_analysis'),
    fetchAllRows(supabase, 'lyric_words'),
    fetchAllRows(supabase, 'support_points'),
  ]);

  collectTtsTexts(analysisRows, texts);
  collectTtsTexts(wordRows, texts);

  for (const text of await readSupportPointTexts(supabase, supportPointRows)) {
    texts.add(text);
  }

  return {
    texts: [...texts],
    rowCounts: {
      lyricLineAnalysis: analysisRows.length,
      lyricWords: wordRows.length,
      supportPoints: supportPointRows.length,
    },
  };
}

async function readCachedTexts(supabase: any, voice: string) {
  const rows: any[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('tts_audio_cache')
      .select('text')
      .eq('voice', voice)
      .range(from, to);
    if (error) throw error;

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return new Set(rows.map((row) => normalizeText(row.text || '')).filter(Boolean));
}

function writeMissingReport(missing: string[], voice: string) {
  const reportDir = path.resolve('docs');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'tts-cache-missing.txt');
  const body = [
    `voice: ${voice}`,
    `missing_count: ${missing.length}`,
    '',
    ...missing,
    '',
  ].join('\n');
  fs.writeFileSync(reportPath, body, 'utf8');
  return reportPath;
}

function getEdgeTtsCommand() {
  const configuredCommand = process.env.EDGE_TTS_COMMAND;
  const discoveredCommand = spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    '(Get-Command edge-tts -ErrorAction SilentlyContinue).Source',
  ], { encoding: 'utf8' }).stdout.trim();
  return configuredCommand || discoveredCommand || 'edge-tts';
}

function runEdgeTts(command: string, text: string, voice: string, outputFile: string, textFile: string) {
  fs.writeFileSync(textFile, text, 'utf8');
  const args = ['--voice', voice, '--file', textFile, '--write-media', outputFile];

  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`edge-tts failed with exit code ${code}`));
    });
  });
}

function audioPathFor(text: string, voice: string) {
  const hash = crypto.createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 24);
  return `${voice}/${hash}.mp3`;
}

async function main() {
  const apply = hasArg('apply');
  const voice = argValue('voice', DEFAULT_VOICE);
  const limit = Number(argValue('limit', '0'));
  const concurrency = Math.max(1, Number(argValue('concurrency', '4')) || 4);
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase configuration in .env.');

  const supabase = createClient(supabaseUrl, serviceKey);
  const localTexts = readLocalTexts();
  const databaseTexts = await readDatabaseTexts(supabase);
  const texts = [...new Set([...localTexts, ...databaseTexts.texts])].sort((a, b) => a.localeCompare(b, 'ko'));
  const selectedTexts = limit > 0 ? texts.slice(0, limit) : texts;
  const cachedTexts = await readCachedTexts(supabase, voice);
  const missingTexts = selectedTexts.filter((text) => !cachedTexts.has(text));
  const missingReportPath = writeMissingReport(missingTexts, voice);

  console.log(JSON.stringify({
    mode: apply ? 'generate-and-upload' : 'check-only',
    voice,
    concurrency,
    localTextCount: localTexts.length,
    databaseTextCount: databaseTexts.texts.length,
    databaseRowCounts: databaseTexts.rowCounts,
    totalTextCount: texts.length,
    selectedTextCount: selectedTexts.length,
    cachedTextCount: cachedTexts.size,
    missingTextCount: missingTexts.length,
    missingReportPath,
  }, null, 2));

  if (!apply) {
    if (missingTexts.length) {
      console.log('Missing audio examples:');
      console.log(missingTexts.slice(0, 30).join('\n'));
      console.log('Add --apply to generate missing MP3 files and upload them.');
      process.exitCode = 1;
      return;
    }

    console.log('All selected texts already have cached audio.');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-tts-'));
  const edgeTtsCommand = getEdgeTtsCommand();

  let created = 0;
  let skipped = 0;
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= selectedTexts.length) return;

      const text = selectedTexts[index];
      const { data: existing, error: lookupError } = await supabase
        .from('tts_audio_cache')
        .select('id')
        .eq('voice', voice)
        .eq('text', text)
        .maybeSingle();

      if (lookupError) throw lookupError;
      if (existing) {
        skipped += 1;
        continue;
      }

      const storagePath = audioPathFor(text, voice);
      const id = crypto.randomUUID();
      const localFile = path.join(tmpDir, `${id}.mp3`);
      const textFile = path.join(tmpDir, `${id}.txt`);

      console.log(`[${index + 1}/${selectedTexts.length}] generating: ${text}`);
      await runEdgeTts(edgeTtsCommand, text, voice, localFile, textFile);

      const fileBuffer = fs.readFileSync(localFile);
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: 'audio/mpeg',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
      const audioUrl = publicData.publicUrl;

      const { error: upsertError } = await supabase
        .from('tts_audio_cache')
        .upsert({
          text,
          voice,
          audio_url: audioUrl,
          storage_path: storagePath,
          provider: 'edge-tts',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'text,voice' });

      if (upsertError) throw upsertError;

      fs.rmSync(localFile, { force: true });
      fs.rmSync(textFile, { force: true });
      created += 1;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(JSON.stringify({ created, skipped }, null, 2));
}

main().catch((error: any) => {
  console.error(`ERROR: ${error.message || error}`);
  process.exit(1);
});
