import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

// Load environmental parameters
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

console.log("==================================================");
console.log("       K-POP Auto AI Lyrics Analyzer & Importer   ");
console.log("==================================================");

if (!supabaseUrl || !supabaseKey) {
  console.error("ERROR: Missing Supabase configurations in environment.");
  console.error("Make sure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are declared.");
  process.exit(1);
}

if (!geminiApiKey) {
  console.error("ERROR: Missing GEMINI_API_KEY env variable.");
  console.error("Please provide your Gemini API key inside secrets or .env file.");
  process.exit(1);
}

// Instantiate clients
const supabase = createClient(supabaseUrl, supabaseKey);
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// LRC Lyric Parser
interface LrcLine {
  lineIndex: number;
  time: number;
  text: string;
}

function parseLyricsToCleanLines(lyrics: string): LrcLine[] {
  if (!lyrics) return [];
  const lines = lyrics.split(/\r?\n/);
  const result: LrcLine[] = [];
  let indexCounter = 1;

  lines.forEach((line) => {
    const rawText = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();
    if (!rawText) return; // skip blank rows

    // Find time tag to establish a virtual chronological order
    const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\]/);
    let absoluteTime = 0;
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const milliseconds = parseInt(match[3]);
      absoluteTime = minutes * 60 + seconds + milliseconds / (match[3].length === 3 ? 1000 : 100);
    }

    result.push({
      lineIndex: indexCounter++,
      time: absoluteTime,
      text: rawText,
    });
  });

  return result;
}

async function run() {
  const args = process.argv.slice(2);
  const targetSongId = args[0];

  console.log(`Connecting to Supabase: ${supabaseUrl}`);

  // Fetch song entries
  let query = supabase.from('songs').select('*');
  if (targetSongId) {
    query = query.eq('songId', targetSongId);
    console.log(`Targeting single songId: "${targetSongId}"`);
  } else {
    console.log("No specific song ID provided. Scanning catalog to offer choice...");
  }

  const { data: songs, error: songsErr } = await query;
  if (songsErr) {
    console.error("Failed to query 'songs' table:", songsErr.message);
    process.exit(1);
  }

  if (!songs || songs.length === 0) {
    console.error("No songs found in your 'songs' database! Please add some songs first.");
    process.exit(1);
  }

  let selectedSong = songs[0];

  if (!targetSongId && songs.length > 1) {
    console.log("\nFound multiple songs in your DB:");
    songs.forEach((s, idx) => {
      console.log(`  [${idx + 1}] ID: ${s.songId || s.id} - Title: ${s.songName || s.name}`);
    });
    console.log(`\nDefaulting to the first song: "${selectedSong.songName || 'Untitled'}"`);
    console.log("Tip: Run this script with a parameter to specify target id: npx tsx scripts/auto_analyze.ts <songId>\n");
  }

  const songId = selectedSong.songId || selectedSong.song_id || String(selectedSong.id);
  const songName = selectedSong.songName || selectedSong.name || "Untitled";
  const rawLyrics = selectedSong.lyrics || "";

  if (!rawLyrics.trim()) {
    console.error(`ERROR: The selected song "${songName}" has empty lyrics! Modify the song record first.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`Analyzing: "${songName}" (ID: ${songId})`);
  console.log(`Length of original lyric field: ${rawLyrics.length} chars`);
  console.log(`==================================================\n`);

  console.log("Parsing LRC timestamps to clean text lines...");
  const parsedLines = parseLyricsToCleanLines(rawLyrics);
  console.log(`Successfully parsed ${parsedLines.length} lyric lines! Preparing AI prompt...`);

  // Prompt building
  const linesPayload = parsedLines.map(l => `[Line ${l.lineIndex}] KOREAN: ${l.text}`).join('\n');

  const systemInstruction = `You are an elite, highly professional K-POP Korean language learning specialist. Your job is to analyze K-POP song lyrics to provide a perfect educational outline inside a structured JSON payload.
You must analyze each line of the song. For each line, do the following:
1. line_index: Must match the original line number provided (starts at 1).
2. original_ko: The exact Korean/English string of this line.
3. natural_translation_zh: A beautiful, contextual Chinese translation of this line.
4. literal_translation_zh: A word-by-word literal Chinese translation matching the Korean word order to help beginners understand the grammatical layout.
5. word_breakdown: Array of core vocabulary words used in this specific line. For each vocabulary word:
   - surface: The surface form as it appears in this line (with particles attached if applicable, e.g. "세상에").
   - lemma: The dictionary base/root form of the word (e.g. "세상").
   - meaning_zh: The Chinese translation of the base word.
   - part_of_speech: Core lexical part of speech of the base word, abbreviated as: "n." (for noun), "v." (for verb), "adj." (for adjective), "adv." (for adverb), "pron." (for pronoun), "conj." (for conjunction), "part." (for particle/particle-suffix), "int." (for interjection). Must use these precise abbreviations.
   - level: Categorize into appropriate learning tiers "L1", "L2", "L3", "L4", "L5", or "L6". L1 is beginner, L6 is advanced.
   - pronunciation: The standard Romanized pronunciation / phonetics (Korean Revised Romanization) of the word (e.g., "meot-jim" for "멋짐", "se-sang-e" for "세상에").
6. grammar_note_zh: An educational explanation in Chinese highlighting Korean grammar rules, suffixes, particles, idioms, or colloquialisms found in this line. Let it be clean and clear.
7. level: The general recommended Korean learning level of this line ("L1", "L2", "L3", "L4", "L5", "L6").
8. priority_score: An integer from 0 to 100 based on the usefulness of the line for everyday Korean standard learning. High priority indicates conversational high frequency.
9. tts_text: The optimized text to be passed to Text-to-Speech engines. Normally same as original_ko but skip random sound effects (like "Oh!", "Dingga").

In addition to line-by-line breakdown, you must compile a global summarized vocabulary list "words" of core high-priority nouns, verbs, and expressions across the entire song. For each global word item:
- surface_form: Most common surface form.
- lemma: Base dictionary form.
- meaning_zh: Chinese explanation.
- part_of_speech: Abbreviated part of speech (e.g., "n.", "v.", "adj.", "adv.", "pron.", "conj.", "part.", "int.").
- level: "L1" - "L6" tier.
- frequency_in_song: Approximate count of occurrences in prompt lyrics.
- source_line_indexes: Array of line indices (integers) where this word originates.
- priority_score: 0 to 100 learning priority.
- tts_text: Text for speech pronunciation (same as lemma or surface_form).
- pronunciation: The standard Romanized pronunciation / phonetics (Korean Revised Romanization) of the glossary entry (e.g., "meot-ji-da" for "멋지다").

CRITICAL EXCLUSION AND PHONETICS MANDATES:
1. NO ENGLISH WORDS RECONSTRUCTED: Do NOT include any purely English words, English phrases, or standard English loanwords (such as "cool", "HIP", "wanna", "gimmick", "trendy", "line", etc.) inside some word_breakdown arrays or in the global summarized words lists. Focus 100% on analyzing and breaking down actual KOREAN words/expression elements.
2. NO PURE GRAMMAR PATTERNS OR SUFFIX EXPRESSIONS IN WORDS/BREAKDOWNS: If a feature or element is a purely grammatical structure, secondary syntax pattern, noun-suffix particle expression, modal auxiliary form, or verb suffix (e.g. "-뿐이다", "-ㄴ걸", "-마다", "-면서"), do NOT display or list it as a vocabulary word in the "word_breakdown" array or global "words" list. Vocabulary must consist STRICTLY of base dictionary-entry words (nouns, verbs, adjectives, adverbs, pronouns, particles, etc.) with standard abbreviated POS. All grammatical features must instead be explained in detail in "grammar_note_zh".
3. PURE ENGLISH LINES: For any lyric lines that are entirely in English (e.g., "[Line X] KOREAN: All I wanna be is cool"), you must translate them in natural_translation_zh & literal_translation_zh, but you MUST set word_breakdown to empty ([]), and make the grammar_note_zh a simple text (e.g. "全英文歌词行，无韩语词汇与文法拆解。").
4. ROMANIZED PHONETICS: Provide accurate, readable Revised Romanization for the pronunciation fields. Lowercase with hyphens between syllables is preferred (e.g. "ha-na-b-un-in-geol").`;

  console.log("Contacting Gemini API with 'gemini-3.5-flash' model...");
  console.log("Generating analysis structure, please stand by (this takes ~10-20 seconds)...");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Here are the lyrics of the K-POP song titled "${songName}" mapped with line indexes:\n\n${linesPayload}\n\nPlease perform deep language education analysis on ALL requested lines. Ensure no line is left behind.`,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1, // low temperature for consistency
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["line_analyses", "words"],
          properties: {
            line_analyses: {
              type: Type.ARRAY,
              description: "List of educational breakdown per each lyric line.",
              items: {
                type: Type.OBJECT,
                required: [
                  "line_index",
                  "original_ko",
                  "natural_translation_zh",
                  "literal_translation_zh",
                  "word_breakdown",
                  "grammar_note_zh",
                  "level",
                  "priority_score",
                  "tts_text"
                ],
                properties: {
                  line_index: { type: Type.INTEGER },
                  original_ko: { type: Type.STRING },
                  natural_translation_zh: { type: Type.STRING },
                  literal_translation_zh: { type: Type.STRING },
                  word_breakdown: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      required: ["surface", "lemma", "meaning_zh", "part_of_speech", "level", "pronunciation"],
                      properties: {
                        surface: { type: Type.STRING },
                        lemma: { type: Type.STRING },
                        meaning_zh: { type: Type.STRING },
                        part_of_speech: { type: Type.STRING },
                        level: { type: Type.STRING },
                        pronunciation: { type: Type.STRING }
                      }
                    }
                  },
                  grammar_note_zh: { type: Type.STRING },
                  level: { type: Type.STRING, description: "One of L1, L2, L3, L4, L5, L6" },
                  priority_score: { type: Type.INTEGER },
                  tts_text: { type: Type.STRING }
                }
              }
            },
            words: {
              type: Type.ARRAY,
              description: "Song-wide core vocabulary compilation list.",
              items: {
                type: Type.OBJECT,
                required: [
                  "surface_form",
                  "lemma",
                  "meaning_zh",
                  "part_of_speech",
                  "level",
                  "frequency_in_song",
                  "source_line_indexes",
                  "priority_score",
                  "tts_text",
                  "pronunciation"
                ],
                properties: {
                  surface_form: { type: Type.STRING },
                  lemma: { type: Type.STRING },
                  meaning_zh: { type: Type.STRING },
                  part_of_speech: { type: Type.STRING },
                  level: { type: Type.STRING },
                  frequency_in_song: { type: Type.INTEGER },
                  source_line_indexes: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER }
                  },
                  priority_score: { type: Type.INTEGER },
                  tts_text: { type: Type.STRING },
                  pronunciation: { type: Type.STRING }
                }
              }
            }
          }
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Zero-length response text obtained from Gemini!");
    }

    const payload = JSON.parse(resultText);
    const { line_analyses, words: parsedWords } = payload;

    console.log(`\n✔ AI successfully generated analysis!`);
    console.log(`- Mapped analyzed lines: ${line_analyses?.length || 0} rows`);
    console.log(`- Distinct vocabularies: ${parsedWords?.length || 0} items`);

    // Writing into Database: Clear old matches first for clean idempotency
    console.log(`\nClearing previous study entries in Supabase matching song_id: "${songId}"...`);
    
    // Clear matches
    const { error: clearLAnalysesErr } = await supabase
      .from('lyric_line_analysis')
      .delete()
      .eq('song_id', songId);

    if (clearLAnalysesErr) {
      console.warn("Notice: lyric_line_analysis clear got warning. (Table may not exist yet or empty):", clearLAnalysesErr.message);
    }

    const { error: clearLWordsErr } = await supabase
      .from('lyric_words')
      .delete()
      .eq('song_id', songId);

    if (clearLWordsErr) {
      console.warn("Notice: lyric_words clear got warning. (Table may not exist yet or empty):", clearLWordsErr.message);
    }

    console.log("Database cleared successfully. Writing new analyses...");

    // Insert lyric_line_analysis
    const dbLines = (line_analyses || []).map((line: any) => ({
      song_id: songId,
      line_index: line.line_index,
      original_ko: line.original_ko,
      natural_translation_zh: line.natural_translation_zh,
      literal_translation_zh: line.literal_translation_zh,
      word_breakdown_json: line.word_breakdown,
      grammar_note_zh: line.grammar_note_zh,
      level: line.level,
      priority_score: line.priority_score || 0,
      tts_text: line.tts_text || line.original_ko
    }));

    if (dbLines.length > 0) {
      const { data: insertedLines, error: insertLinesErr } = await supabase
        .from('lyric_line_analysis')
        .insert(dbLines)
        .select();

      if (insertLinesErr) {
        console.error("❌ ERROR inserting lyric_line_analysis:", insertLinesErr.message);
        console.error("Make sure your database schema is up-to-date and supports this table.");
        process.exit(1);
      }
      console.log(`✔ Successfully saved ${insertedLines?.length || dbLines.length} line analytical entries!`);
    }

    // Insert lyric_words
    const dbWords = (parsedWords || []).map((word: any) => ({
      song_id: songId,
      surface_form: word.surface_form,
      lemma: word.lemma || word.surface_form,
      meaning_zh: word.meaning_zh,
      pronunciation: word.pronunciation || null,
      part_of_speech: word.part_of_speech,
      level: word.level,
      frequency_in_song: word.frequency_in_song || 1,
      source_line_ids: [], // optional
      source_line_indexes: word.source_line_indexes || [],
      priority_score: word.priority_score || 0,
      tts_text: word.tts_text || word.surface_form
    }));

    if (dbWords.length > 0) {
      const { data: insertedWords, error: insertWordsErr } = await supabase
        .from('lyric_words')
        .insert(dbWords)
        .select();

      if (insertWordsErr) {
        console.error("❌ ERROR inserting lyric_words:", insertWordsErr.message);
        process.exit(1);
      }
      console.log(`✔ Successfully saved ${insertedWords?.length || dbWords.length} vocabulary study records!`);
    }

    console.log(`\n==================================================`);
    console.log(`🎉 Direct AI Automation Complete for "${songName}"!`);
    console.log(`==================================================\n`);

  } catch (err: any) {
    console.error("❌ Failed during AI Analysis run loop:", err.message || err);
    process.exit(1);
  }
}

run();
