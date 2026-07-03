import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

type SongSpec = {
  id: string;
  name: string;
  fileBase: string;
};

type ParsedLyric = {
  line_index: number;
  original_ko: string;
  start_time: number;
  end_time: number | null;
  timestamp: string;
};

const BUCKET = 'kpop-project data';
const SONGS: SongSpec[] = [
  { id: '4x4ever01', name: '4x4ever', fileBase: '4x4ever' },
  { id: 'I Miss You01', name: 'I Miss You', fileBase: 'I Miss You' },
  { id: 'My star01', name: 'My star', fileBase: 'My star' },
  { id: 'No More Drama01', name: 'No More Drama', fileBase: 'No More Drama' },
  { id: 'Rainy Season01', name: 'Rainy Season', fileBase: '장마' },
];

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function cleanLyricText(value: string): string {
  return value.replace(/\s*\(翻译：.*\)\s*$/, '').trim();
}

function parseLrc(content: string): ParsedLyric[] {
  const parsed: Omit<ParsedLyric, 'end_time'>[] = [];
  const timestampPattern = /^\[(\d{1,3}):(\d{2})[.:](\d{2,3})\](.*)$/;
  const creditPattern = /^(?:作词|作曲|编曲|演唱|制作人|翻译|歌词)：?/;

  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = rawLine.trim().match(timestampPattern);
    if (!match) continue;
    const text = cleanLyricText(match[4]);
    if (!text || creditPattern.test(text)) continue;
    const fraction = Number(match[3]) / (match[3].length === 3 ? 1000 : 100);
    parsed.push({
      line_index: parsed.length + 1,
      original_ko: text,
      start_time: Number(match[1]) * 60 + Number(match[2]) + fraction,
      timestamp: `[${match[1].padStart(2, '0')}:${match[2]}.${match[3]}]`,
    });
  }

  return parsed.map((line, index) => ({
    ...line,
    end_time: parsed[index + 1]?.start_time ?? null,
  }));
}

function detectImage(file: Buffer): { extension: string; contentType: string } {
  if (file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: '.png', contentType: 'image/png' };
  }
  if (file[0] === 0xff && file[1] === 0xd8) {
    return { extension: '.jpg', contentType: 'image/jpeg' };
  }
  throw new Error('Cover must be a valid PNG or JPEG image.');
}

async function main() {
  const source = path.resolve(argValue('source') || '../new-songs');
  const apply = process.argv.includes('--apply');
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const prepared = SONGS.map((song) => {
    const audioPath = path.join(source, `${song.fileBase}.mp3`);
    const lyricsPath = path.join(source, `${song.fileBase}.lrc`);
    const coverPath = path.join(source, `${song.fileBase}.jpg`);
    for (const filePath of [audioPath, lyricsPath, coverPath]) {
      if (!fs.existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
    }
    const lyrics = parseLrc(fs.readFileSync(lyricsPath, 'utf8'));
    if (!lyrics.length) throw new Error(`No usable lyrics: ${lyricsPath}`);
    const cover = fs.readFileSync(coverPath);
    const image = detectImage(cover);
    return {
      ...song,
      audio: fs.readFileSync(audioPath),
      lyrics,
      cleanLrc: lyrics.map((line) => `${line.timestamp}${line.original_ko}`).join('\n'),
      cover,
      image,
    };
  });

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const ids = prepared.map((song) => song.id);
  const { data: existing, error: existingError } = await supabase
    .from('songs')
    .select('songId,songName')
    .in('songId', ids);
  if (existingError) throw existingError;
  if (existing?.length) {
    throw new Error(`Songs already exist: ${existing.map((song) => song.songName).join(', ')}`);
  }

  console.table(prepared.map((song) => ({
    id: song.id,
    name: song.name,
    lyricLines: song.lyrics.length,
    coverType: song.image.contentType,
  })));
  if (!apply) {
    console.log('Check passed. Add --apply to publish.');
    return;
  }

  for (const song of prepared) {
    const uploadedPaths: string[] = [];
    try {
      const audioObjectPath = `music/${song.id}.mp3`;
      const coverObjectPath = `cover/${song.id}${song.image.extension}`;
      const { error: audioError } = await supabase.storage
        .from(BUCKET)
        .upload(audioObjectPath, song.audio, { contentType: 'audio/mpeg', upsert: false });
      if (audioError) throw audioError;
      uploadedPaths.push(audioObjectPath);

      const { error: coverError } = await supabase.storage
        .from(BUCKET)
        .upload(coverObjectPath, song.cover, { contentType: song.image.contentType, upsert: false });
      if (coverError) throw coverError;
      uploadedPaths.push(coverObjectPath);

      const audioUrl = supabase.storage.from(BUCKET).getPublicUrl(audioObjectPath).data.publicUrl;
      const coverUrl = supabase.storage.from(BUCKET).getPublicUrl(coverObjectPath).data.publicUrl;

      const { error: lyricError } = await supabase.from('lyric_lines').insert(
        song.lyrics.map(({ timestamp: _timestamp, ...line }) => ({ song_id: song.id, ...line })),
      );
      if (lyricError) throw lyricError;

      const { error: songError } = await supabase.from('songs').insert({
        songId: song.id,
        songName: song.name,
        coverImg: coverUrl,
        audiourl: audioUrl,
        lyrics: song.cleanLrc,
      });
      if (songError) throw songError;
      console.log(`Published: ${song.name}`);
    } catch (error) {
      await supabase.from('songs').delete().eq('songId', song.id);
      await supabase.from('lyric_lines').delete().eq('song_id', song.id);
      if (uploadedPaths.length) await supabase.storage.from(BUCKET).remove(uploadedPaths);
      throw error;
    }
  }
}

main().catch((error: any) => {
  console.error(`ERROR: ${error.message || error}`);
  process.exit(1);
});
