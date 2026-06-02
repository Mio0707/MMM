import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './supabase';
import { 
  Search, 
  Play, 
  Pause, 
  ChevronLeft, 
  ChevronDown,
  ChevronUp,
  RotateCcw,
  RotateCw,
  Music,
  Eye,
  EyeOff,
  Volume2,
  Check,
  BookOpen,
  Headphones,
  HelpCircle,
  Layers,
  Star
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Song {
  songId: string;
  songName: string;
  coverImg: string;
  audioUrl: string;
  lyrics?: string;
}

interface SupportPoint {
  id?: string;
  songId: string;
  time: number;
  textList: string[];
  translation?: string;
  gifUrl?: string;
}


interface LyricLineAnalysis {
  id?: string;
  song_id: string;
  lyric_line_id?: string;
  line_index: number;
  original_ko: string;
  natural_translation_zh: string;
  literal_translation_zh: string;
  word_breakdown_json: Array<{
    surface: string;
    lemma: string;
    meaning_zh: string;
    part_of_speech: string;
    level: string;
    pronunciation?: string;
  }>;
  grammar_note_zh: string;
  level: string;
  priority_score?: number;
  tts_text?: string;
}

interface LyricWord {
  id?: string;
  song_id: string;
  surface_form: string;
  lemma?: string;
  meaning_zh: string;
  form_note_zh?: string;
  part_of_speech?: string;
  level: string;
  frequency_in_song?: number;
  source_line_ids?: string[];
  source_line_indexes?: number[];
  priority_score?: number;
  tts_text?: string;
  pronunciation?: string;
}

type View = 'home' | 'practice' | 'result' | 'lyrics' | 'lyrics_player';


// --- Web Speech Synthesis Function ---
function speakKorean(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  // Cancel previous synth tasks first
  window.speechSynthesis.cancel();
  
  // Optimize fully capitalized acronyms for phonetic speech
  const optimizedText = text.replace(/[A-Z]{2,}/g, (match) => match.toLowerCase());
  const utterance = new SpeechSynthesisUtterance(optimizedText);
  utterance.lang = 'ko-KR';
  utterance.rate = 0.85; // Slow down slightly for easier listening
  window.speechSynthesis.speak(utterance);
}

const hasText = (value?: string | null) => Boolean(value && value.trim().length > 0);

const hasUsableWordBreakdown = (items?: LyricLineAnalysis['word_breakdown_json'] | null) => {
  return Boolean(items?.some((item) =>
    hasText(item.surface) ||
    hasText(item.lemma) ||
    hasText(item.meaning_zh) ||
    hasText(item.part_of_speech) ||
    hasText(item.pronunciation)
  ));
};

const hasLineAnalysisContent = (analysis?: LyricLineAnalysis | null) => {
  if (!analysis) return false;
  return (
    hasText(analysis.original_ko) ||
    hasText(analysis.natural_translation_zh) ||
    hasText(analysis.literal_translation_zh) ||
    hasText(analysis.grammar_note_zh) ||
    hasUsableWordBreakdown(analysis.word_breakdown_json)
  );
};
const normalizeAnalysisSentence = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();

const getUniqueLineAnalyses = (items: LyricLineAnalysis[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const sentence = normalizeAnalysisSentence(item.original_ko);
    if (!sentence) return false;
    const key = sentence.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
// --- App Entry Component ---
export default function App() {
  const [view, setView] = useState<View>('home');
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [results, setResults] = useState<any>(null);
  const [showModeModal, setShowModeModal] = useState(false);
  const [pendingSong, setPendingSong] = useState<Song | null>(null);

  useEffect(() => {
    fetchSongs();
  }, []);

  const fetchSongs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('*');
      
      if (error) throw error;
      
      const normalizedSongs = (data || []).map((s: any) => {
        return {
          songId: s.songId || s.song_id || s.songid || String(s.id),
          songName: s.songName || s.song_name || s.songname || s.name || "Untitled",
          coverImg: s.coverImg || s.cover_img || s.coverimg || s.image_url || s.thumbnail || "",
          audioUrl: s.audioUrl || s.audio_url || s.audiourl || s.url || "",
          lyrics: s.lyrics || ""
        };
      });

      setSongs(normalizedSongs);
    } catch (err) {
      console.error('鍔犺浇澶辫触', err);
    } finally {
      setLoading(false);
    }
  };

  // --- Router & URL sync using window.location.hash ---
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (!hash || hash === '#/' || hash === '#') {
        setView('home');
        setSelectedSong(null);
        return;
      }

      // Chant practice view: #/chant/:songId
      const chantMatch = hash.match(/^#\/chant\/([^/]+)$/);
      if (chantMatch && songs.length > 0) {
        const id = decodeURIComponent(chantMatch[1]);
        const found = songs.find(s => s.songId === id);
        if (found) {
          setSelectedSong(found);
          setView('practice');
          return;
        }
      }

      // Full lyrics player view: #/lyrics/:songId/player
      const playerMatch = hash.match(/^#\/lyrics\/([^/]+)\/player$/);
      if (playerMatch && songs.length > 0) {
        const id = decodeURIComponent(playerMatch[1]);
        const found = songs.find(s => s.songId === id);
        if (found) {
          setSelectedSong(found);
          setView('lyrics_player');
          return;
        }
      }

      // Lyrics learning view: #/lyrics/:songId
      const lyricsMatch = hash.match(/^#\/lyrics\/([^/]+)$/);
      if (lyricsMatch && songs.length > 0) {
        const id = decodeURIComponent(lyricsMatch[1]);
        const found = songs.find(s => s.songId === id);
        if (found) {
          setSelectedSong(found);
          setView('lyrics');
          return;
        }
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    // Execute hash matching once songs are fully fetched
    if (songs.length > 0) {
      handleHashChange();
    }
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [songs]);

  // Navigate utility
  const navigateTo = (newView: View, songId?: string) => {
    if (newView === 'home') {
      window.location.hash = '#/';
      setView('home');
      setSelectedSong(null);
    } else if (newView === 'practice' && songId) {
      window.location.hash = `#/chant/${encodeURIComponent(songId)}`;
      setView('practice');
    } else if (newView === 'lyrics' && songId) {
      window.location.hash = `#/lyrics/${encodeURIComponent(songId)}`;
      setView('lyrics');
    } else if (newView === 'lyrics_player' && songId) {
      window.location.hash = `#/lyrics/${encodeURIComponent(songId)}/player`;
      setView('lyrics_player');
    }
  };

  const filteredSongs = useMemo(() => {
    return songs.filter(s => s.songName.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [songs, searchQuery]);

  const handleSongSelect = (song: Song) => {
    setPendingSong(song);
    setShowModeModal(true);
  };

  const handleFinish = (finalResults: any) => {
    setResults(finalResults);
    setView('result');
  };

  return (
    <div className="min-h-screen bg-bg-dark flex flex-col max-w-[1024px] mx-auto shadow-2xl relative overflow-hidden font-sans">
      {/* Background Decorative Elements */}
      <div className="glow-primary top-[-100px] right-[-100px]" />
      <div className="glow-secondary bottom-[-100px] left-[-100px]" />

      <AnimatePresence mode="wait">
        {view === 'home' && (
          <HomeView 
            key="home"
            songs={filteredSongs} 
            loading={loading}
            onSelect={handleSongSelect}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />
        )}
        {view === 'practice' && selectedSong && (
          <PracticeView
            key="practice"
            song={selectedSong}
            onBack={() => navigateTo('home')}
            onFinish={handleFinish}
          />
        )}
        {view === 'result' && selectedSong && (
          <ResultView
            key="result"
            song={selectedSong}
            results={results}
            onRestart={() => navigateTo('practice', selectedSong.songId)}
            onHome={() => navigateTo('home')}
          />
        )}
        {view === 'lyrics' && selectedSong && (
          <LyricsLearningView
            key="lyrics"
            song={selectedSong}
            onBack={() => navigateTo('home')}
            onGoPlayer={() => navigateTo('lyrics_player', selectedSong.songId)}
          />
        )}
        {view === 'lyrics_player' && selectedSong && (
          <LyricsPlayerView
            key="lyrics_player"
            song={selectedSong}
            onBack={() => navigateTo('lyrics', selectedSong.songId)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showModeModal && pendingSong && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/45 backdrop-blur-md flex items-center justify-center p-5 z-50 pointer-events-auto">
            <motion.div initial={{ scale: 0.96, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 16 }} className="w-full max-w-sm bg-white text-slate-950 rounded-[28px] p-6 border border-slate-200 shadow-2xl relative overflow-hidden">
              <button onClick={() => { setShowModeModal(false); setPendingSong(null); }} className="absolute top-4 left-4 w-11 h-11 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center shadow-sm cursor-pointer" title="返回"><ChevronLeft className="w-5 h-5 text-slate-900" /></button>
              <div className="flex flex-col items-center pt-8 mb-7"><img src={pendingSong.coverImg} alt={pendingSong.songName} className="w-32 h-32 rounded-[28px] object-cover border border-slate-200 shadow-lg mb-4" /><p className="text-sm font-bold text-slate-500 tracking-[0.12em]">选择功能</p></div>
              <div className="space-y-4">
                <button onClick={() => { const songId = pendingSong.songId; setSelectedSong(pendingSong); setShowModeModal(false); setPendingSong(null); navigateTo('lyrics', songId); }} className="w-full flex items-center gap-4 p-5 rounded-3xl bg-rose-50 border border-rose-100 text-left cursor-pointer"><div className="w-14 h-14 bg-rose-100 text-primary rounded-2xl flex items-center justify-center"><BookOpen className="w-6 h-6" /></div><h4 className="font-black italic text-2xl tracking-tight text-slate-950">歌词学习</h4></button>
                <button onClick={() => { const songId = pendingSong.songId; setSelectedSong(pendingSong); setShowModeModal(false); setPendingSong(null); navigateTo('practice', songId); }} className="w-full flex items-center gap-4 p-5 rounded-3xl bg-purple-50 border border-purple-100 text-left cursor-pointer"><div className="w-14 h-14 bg-purple-100 text-secondary rounded-2xl flex items-center justify-center"><Headphones className="w-6 h-6" /></div><h4 className="font-black italic text-2xl tracking-tight text-slate-950">应援口号</h4></button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Views & Sub-elements ---

// 1. Home View
function HomeView({ songs, loading, onSelect, searchQuery, setSearchQuery }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 p-8 relative z-10"
    >
      <header className="flex justify-between items-center mb-8 relative z-10 font-sans">
        <div>
          <h1 className="text-3xl font-black tracking-tighter bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent italic">
            Let's Dingga!
          </h1>
        </div>
      </header>

      <div className="relative mb-8 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
        <input 
          type="text"
          placeholder="Search Songs..."
          className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-10 text-sm outline-none focus:border-primary/50 transition-all text-white"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="mb-4">
        <h2 className="text-[14px] font-bold leading-[29px] text-[#8c7898] [font-family:system-ui]">MAMAMOO is coming back!</h2>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-500 text-xs tracking-widest uppercase">Fetching data...</p>
        </div>
      ) : songs.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          <Music className="w-12 h-12 mx-auto mb-4 opacity-10" />
          <p className="text-sm">No hits found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {songs.map((song: Song) => (
            <motion.div 
              key={song.songId}
              whileHover={{ y: -5 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelect(song)}
              className="bg-accent-dark/30 border border-white/5 rounded-3xl overflow-hidden shadow-xl cursor-pointer group"
            >
              <div className="aspect-square relative">
                <img src={song.coverImg} alt={song.songName} className="w-full h-full object-cover grayscale-[20%] group-hover:grayscale-0 transition-all duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
                <div className="absolute bottom-3 left-3 right-3">
                  <h3 className="font-bold text-sm line-clamp-1 text-white">{song.songName}</h3>
                </div>
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="bg-primary p-2 rounded-full shadow-lg">
                    <Play className="w-3 h-3 fill-white text-white" />
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}


// 2. Original Practice Chants View
function PracticeView({ song, onBack, onFinish }: { song: Song; onBack: () => void; onFinish: (results: any) => void; key?: string }) {
  const [points, setPoints] = useState<SupportPoint[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activePointIndex, setActivePointIndex] = useState(-1);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [userRecords, setUserRecords] = useState<Record<number, any>>({});
  
  const [isAudioLoading, setIsAudioLoading] = useState(true);
  const [audioError, setAudioError] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef(0);

  // Sync animation
  useEffect(() => {
    const fetchPoints = async () => {
      console.log("--- DEBUG: Fetching points ---");
      console.log("Looking for points for Song Name:", song.songName);
      console.log("Looking for points for Song ID:", song.songId);

      const { data, error } = await supabase
        .from('support_points')
        .select('*')
        .eq('songId', song.songId);
      
      let finalData = data || [];

      if (error) {
        console.error("Supabase Error:", error.message);
      }

      // Normalize points data
      const normalizedPoints = finalData.flatMap((p: any) => {
        if (p.chant && typeof p.chant === 'string') {
          const lines = p.chant.split(/\r?\n/).filter(line => line.trim());
          const pointsFromChant = lines.map(line => {
            const match = line.match(/^\s*\[(?:(\d+):)?([\d.]+)\](.*)$/);
            if (match) {
              const mins = parseFloat(match[1] || '0');
              const secs = parseFloat(match[2]);
              const timeVal = mins * 60 + secs;
              const parts = match[3].split('::').map((s: string) => s.trim());
              const text = parts[0];
              
              let translation = p.translation || p.translated_text || "";
              let gifUrl = p.gifUrl || p.gif_url || "";

              parts.slice(1).forEach(part => {
                const lowerPart = part.toLowerCase();
                if (
                  lowerPart.startsWith('http') || 
                  lowerPart.includes('.gif') || 
                  lowerPart.includes('.webp') || 
                  lowerPart.includes('.jpg') || 
                  lowerPart.includes('.png') ||
                  lowerPart.includes('/storage/v1/object/public/')
                ) {
                  gifUrl = part;
                } else if (part) {
                  translation = part;
                }
              });

              return {
                ...p,
                songId: p.songId || p.song_id,
                time: timeVal,
                textList: [text],
                translation,
                gifUrl
              };
            }
            return null;
          }).filter(Boolean);
          
          if (pointsFromChant.length > 0) return pointsFromChant;
        }

        let timeVal = parseFloat(p.time || p.timestamp || 0);
        let textList = Array.isArray(p.textList) ? p.textList : (p.text_list || (p.text ? [p.text] : []));
        return [{
          ...p,
          songId: p.songId || p.song_id,
          time: timeVal,
          textList: textList,
          translation: p.translation || p.translated_text,
          gifUrl: p.gifUrl || p.gif_url
        }];
      }).sort((a: any, b: any) => a.time - b.time);

      console.log("Points sync success! Count:", normalizedPoints.length);
      setPoints(normalizedPoints);
    };
    fetchPoints();
  }, [song.songId]);

  // Reset states and force load when song changes
  useEffect(() => {
    setIsAudioLoading(true);
    setAudioError(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    
    if (audioRef.current) {
      audioRef.current.load();
    }

    const timer = setTimeout(() => {
      setIsAudioLoading(false);
    }, 8000);

    return () => clearTimeout(timer);
  }, [song.audioUrl]);

  const updateProgress = () => {
    if (audioRef.current && isPlaying) {
      const time = audioRef.current.currentTime;
      setCurrentTime(time);

      // Check for points
      const nextPointIndex = points.findIndex((p, idx) => {
        const isPast = time >= p.time;
        const wasBefore = lastTimeRef.current < p.time;
        const notRecorded = !userRecords[idx];
        
        return isPast && wasBefore && notRecorded;
      });

      if (nextPointIndex !== -1) {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
        
        setActivePointIndex(nextPointIndex);
        setShowSupportModal(true);
      }

      lastTimeRef.current = time;
      animationRef.current = requestAnimationFrame(updateProgress);
    }
  };

  useEffect(() => {
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateProgress);
    } else {
      cancelAnimationFrame(animationRef.current);
    }
    return () => cancelAnimationFrame(animationRef.current);
  }, [isPlaying, points, userRecords]);

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (!audioRef.current.src || audioRef.current.src.includes('undefined')) {
        const fallbackUrl = song.audioUrl || (song as any).audio_url || (song as any).audiourl;
        if (fallbackUrl) {
          audioRef.current.src = fallbackUrl;
          audioRef.current.load();
        }
      }
      
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
          })
          .catch(error => {
            console.error("Audio play interrupted:", error);
          });
      } else {
        setIsPlaying(true);
      }
    }
  };

  const handleSeek = (seconds: number) => {
    if (!audioRef.current) return;
    const newTime = audioRef.current.currentTime + seconds;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    lastTimeRef.current = newTime;
  };

  const handleSeekTo = (time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
    lastTimeRef.current = time;
    if (!isPlaying) handlePlayPause();
  };

  const handlePointSuccess = (data: any) => {
    const newRecords = { ...userRecords, [activePointIndex]: data };
    setUserRecords(newRecords);
    setShowSupportModal(false);
    
    if (Object.keys(newRecords).length === points.length) {
      onFinish({ records: newRecords, points });
    } else {
      // Auto resume
      setTimeout(() => {
        if (audioRef.current) {
          const playPromise = audioRef.current.play();
          if (playPromise !== undefined) {
            playPromise.then(() => setIsPlaying(true)).catch(() => {});
          } else {
            setIsPlaying(true);
          }
        }
      }, 500);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-bg-dark text-white relative h-screen overflow-hidden z-10">
      <div 
        className="absolute inset-0 opacity-20 blur-3xl pointer-events-none scale-150"
        style={{ backgroundImage: `url(${song.coverImg})`, backgroundSize: 'cover' }}
      />

      <div className="relative z-10 flex-1 flex flex-col p-8 overflow-hidden">
        <header className="flex items-center justify-between mb-8">
          <button onClick={onBack} className="p-3 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <h1 className="text-xl font-black italic tracking-tighter uppercase">{song.songName}</h1>
            <div className="text-[8px] uppercase tracking-[0.3em] text-primary font-bold mt-1">Live Training Active</div>
          </div>
        </header>

        <div className="flex-1 flex flex-col w-full overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 custom-scrollbar">
            {points.map((pt, idx) => {
              const isDone = Boolean(userRecords[idx]);
              let currentActiveIdx = -1;
              for (let i = 0; i < points.length; i++) {
                if (currentTime >= points[i].time) {
                  currentActiveIdx = i;
                }
              }
              const isActive = currentActiveIdx === idx;
              
              return (
                <div key={idx} className="flex items-center gap-2">
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => handleSeekTo(pt.time)}
                    className={`flex-1 flex items-center justify-between px-3 h-[28px] rounded-lg border transition-all duration-300 ${
                      isActive 
                        ? 'bg-white/10 border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.05)]' 
                        : 'bg-white/5 border-white/5 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-5 flex justify-center">
                        <div className={`w-1.5 h-1.5 rounded-full ${isDone ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.3)]'}`} />
                      </div>
                      <span className="text-[11px] font-black text-primary w-12 text-left">{pt.time.toFixed(1)}S</span>
                      <span className={`text-[13px] font-black italic uppercase tracking-tight text-left transition-colors duration-300 ${isActive ? 'text-white' : 'text-gray-400'}`}>
                        {pt.textList.join(' ! ')}
                      </span>
                    </div>
                  </motion.button>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      speakKorean(pt.textList.join(' '));
                    }}
                    className="p-1.5 rounded-md hover:bg-white/10 text-gray-500 hover:text-primary transition-all flex-shrink-0 cursor-pointer"
                    title="示范发音"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="h-24 relative w-full overflow-hidden bg-gradient-to-t from-background to-transparent">
            <ScrollingLyrics lyrics={song.lyrics} currentTime={currentTime} isActive={!showSupportModal} />
          </div>
        </div>

        <div className="pb-10 pt-4 max-w-sm mx-auto w-full">
          {audioError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 text-center text-[10px] text-red-500 font-bold uppercase tracking-widest leading-relaxed">
              <div>{audioError}</div>
              <button 
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.load();
                    setIsAudioLoading(true);
                    setAudioError(null);
                  }
                }}
                className="mt-3 block w-full py-2 bg-red-500/20 rounded-lg hover:bg-red-500/30 transition-colors text-white"
              >
                Retry Loading
              </button>
            </div>
          )}
          <div className="flex items-center gap-4 mb-8">
            <span className="text-[10px] font-bold text-gray-500 w-10 text-right">{formatTime(currentTime)}</span>
            <div className="flex-1 h-2 bg-white/5 rounded-full relative group cursor-pointer border border-white/5">
              <div 
                className="absolute top-0 left-0 h-full bg-gradient-kpop transition-all shadow-[0_0_10px_rgba(233,64,87,0.5)] z-0 rounded-full"
                style={{ width: `${(currentTime / duration) * 100}%` }}
              />
              {duration > 0 && points.map((p, idx) => (
                <div 
                  key={idx}
                  className={`absolute top-0 w-[2px] h-full z-10 pointer-events-none transition-all ${
                    currentTime >= p.time 
                      ? 'bg-white/20' 
                      : 'bg-yellow-400/40'
                  }`}
                  style={{ 
                    left: `${(p.time / duration) * 100}%`, 
                    transform: 'translateX(-50%)' 
                  }}
                />
              ))}
              <input 
                type="range"
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-20"
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (audioRef.current) audioRef.current.currentTime = val;
                  setCurrentTime(val);
                  lastTimeRef.current = val;
                }}
              />
            </div>
            <span className="text-[10px] font-bold text-gray-500 w-10">{formatTime(duration)}</span>
          </div>

          <div className="flex items-center justify-center gap-10">
            <button onClick={() => handleSeek(-5)} className="relative w-12 h-12 flex items-center justify-center text-gray-400 hover:text-white transition-colors bg-white/5 rounded-full group cursor-pointer">
              <RotateCcw className="w-7 h-7" />
              <span className="absolute text-[9px] font-black group-hover:scale-110 transition-transform mt-1">-5</span>
            </button>
            <button 
              onClick={handlePlayPause}
              disabled={isAudioLoading && duration === 0}
              className={`w-20 h-20 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(233,64,87,0.4)] hover:scale-105 active:scale-95 transition-transform border-4 border-white/10 cursor-pointer ${
                (isAudioLoading && duration === 0) ? "bg-gray-700 opacity-50 cursor-not-allowed" : "bg-gradient-kpop"
              }`}
            >
              {(isAudioLoading && duration === 0) ? (
                <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-10 h-10 fill-white text-white" />
              ) : (
                <Play className="w-10 h-10 fill-white text-white ml-1" />
              )}
            </button>
            <button onClick={() => handleSeek(5)} className="relative w-12 h-12 flex items-center justify-center text-gray-400 hover:text-white transition-colors bg-white/5 rounded-full group cursor-pointer">
              <RotateCw className="w-7 h-7" />
              <span className="absolute text-[9px] font-black group-hover:scale-110 transition-transform mt-1">+5</span>
            </button>
          </div>
        </div>
      </div>

      <audio 
        ref={audioRef}
        src={song.audioUrl}
        preload="auto"
        crossOrigin="anonymous"
        onLoadStart={() => {
          setIsAudioLoading(true);
          setAudioError(null);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (d > 0 && !isNaN(d)) {
            setDuration(d);
            setIsAudioLoading(false);
          }
        }}
        onCanPlay={() => {
          setIsAudioLoading(false);
          if (audioRef.current && (duration === 0 || isNaN(duration))) {
             const d = audioRef.current.duration;
             if (d > 0 && !isNaN(d)) setDuration(d);
          }
        }}
        onPlaying={() => {
          setIsAudioLoading(false);
          setAudioError(null);
          if (audioRef.current) {
            lastTimeRef.current = audioRef.current.currentTime;
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
        onError={(e) => {
          setIsAudioLoading(false);
          const errorCode = e.currentTarget.error?.code || 4;
          let friendlyMsg = '音频暂时无法加载，请检查网络或音频地址。';
          setAudioError(`音频资源暂时无法响应 (Code: ${errorCode})`);
        }}
      />

      <AnimatePresence>
        {showSupportModal && (
          <SupportModal 
            point={points[activePointIndex]}
            onSuccess={handlePointSuccess}
            onSkip={handlePointSuccess}
            onCancel={() => setShowSupportModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// 3. Lyric lines view background overlay component (scrolling support)
function ScrollingLyrics({ lyrics, currentTime, isActive }: { lyrics?: string, currentTime: number, isActive: boolean }) {
  const lines = useMemo(() => parseLrc(lyrics || ""), [lyrics]);
  
  const activeLine = useMemo(() => {
    let currentLine = null;
    for (let i = 0; i < lines.length; i++) {
      if (currentTime >= lines[i].time) {
        currentLine = lines[i];
      } else {
        break;
      }
    }
    return currentLine;
  }, [lines, currentTime]);

  if (!lines.length) return null;

  return (
    <div className={`absolute inset-0 flex flex-col items-center justify-center px-8 transition-opacity duration-500 pointer-events-none ${isActive ? 'opacity-100' : 'opacity-20'}`}>
      <div className="w-full text-center h-full flex items-center justify-center">
        <AnimatePresence mode="wait">
          {activeLine && (
            <motion.div
              key={activeLine.time}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4 }}
              className="text-lg md:text-xl font-bold text-white/90 tracking-wide drop-shadow-xl"
            >
              {activeLine.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// 4. Score stats Result view
function ResultView({ song, results, onRestart, onHome }: { song: Song; results: any; onRestart: () => void; onHome: () => void; key?: string }) {
  const totalPoints = results.points.length;
  const completed = Object.keys(results.records).length;
  const score = totalPoints > 0 ? Math.round((completed / totalPoints) * 100) : 100;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 p-10 flex flex-col items-center relative z-10"
    >
      <button onClick={onHome} className="absolute top-8 left-8 p-3 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-white cursor-pointer">
        <ChevronLeft className="w-5 h-5" />
      </button>

      <div className="text-center mb-10">
        <h2 className="text-3xl font-black italic tracking-tighter mb-2 uppercase text-white">Chant Complete</h2>
        <p className="text-gray-500 text-[10px] uppercase tracking-widest font-bold">Analytics & Playback</p>
      </div>

      <div className="relative w-40 h-40 mb-12">
        <svg className="w-full h-full transform -rotate-90">
          <circle cx="80" cy="80" r="74" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
          <motion.circle 
            cx="80" cy="80" r="74" 
            stroke="currentColor" strokeWidth="8" fill="transparent" 
            strokeDasharray={465} 
            initial={{ strokeDashoffset: 465 }}
            animate={{ strokeDashoffset: 465 - (465 * score / 100) }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="text-primary" 
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-black text-white">{score}%</span>
          <span className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Match</span>
        </div>
      </div>

      <div className="w-full max-w-sm space-y-4 mb-10">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex justify-between items-center">
          <span className="text-[10px] uppercase font-bold text-gray-400">Total Hits</span>
          <span className="font-black text-white italic">{completed} / {totalPoints}</span>
        </div>
      </div>

      <div className="mt-auto w-full max-w-sm space-y-4">
        <button 
          onClick={onRestart}
          className="w-full py-5 rounded-2xl bg-gradient-kpop text-sm font-black tracking-widest uppercase shadow-[0_10px_30px_rgba(233,64,87,0.3)] active:scale-95 transition-transform cursor-pointer text-white"
        >
          Practice Again
        </button>
        <button 
          onClick={onHome}
          className="w-full py-5 rounded-2xl bg-white/5 border border-white/10 text-sm font-black tracking-widest uppercase text-gray-400 hover:text-white transition-colors cursor-pointer"
        >
          Song Discovery
        </button>
      </div>
    </motion.div>
  );
}

// 5. SupportModal inside chanting view
function SupportModal({ point, onSuccess, onSkip, onCancel }: any) {
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [showHint, setShowHint] = useState(false);

  if (!point) return null;

  const handleCorrect = (data: any) => {
    setIsCorrect(true);
    setTimeout(() => {
      onSuccess(data);
    }, 2000);
  };

  const handleTextSubmit = () => {
    const valid = point.textList.some((t: string) => {
      const normalizedInput = inputText.toLowerCase().replace(/\s+/g, '');
      const normalizedTarget = t.toLowerCase().replace(/\s+/g, '');
      return normalizedInput === normalizedTarget;
    });

    if (valid) {
      handleCorrect({ text: inputText, status: 'correct' });
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-8 pointer-events-auto"
    >
      <div className="w-full max-w-[340px] bg-accent-dark rounded-[40px] p-8 text-white overflow-hidden relative border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <AnimatePresence>
          {isCorrect && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="absolute inset-0 z-30 bg-[#1a1a1a] flex flex-col items-center justify-center p-6 text-center"
            >
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="w-full space-y-6"
              >
                <div className="relative">
                  <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-2 border border-green-500/20">
                    <Check className="w-8 h-8 text-green-500" />
                  </div>
                  <div className="absolute inset-0 bg-green-500/20 rounded-full blur-xl animate-pulse" />
                </div>
                
                {point.gifUrl && (
                  <div className="relative w-48 h-48 mx-auto rounded-[32px] overflow-hidden border-2 border-white/10 shadow-2xl bg-black/40">
                    <img 
                      src={point.gifUrl} 
                      className="w-full h-full object-contain p-2" 
                      alt="Feedback GIF" 
                      referrerPolicy="no-referrer"
                    />
                  </div>
                )}
                
                <div className="space-y-1">
                  <h3 className="text-2xl font-black italic uppercase tracking-tighter text-white">
                    Chant Hit Hit!
                  </h3>
                  {point.translation && (
                    <p className="text-primary font-black text-xs uppercase tracking-widest opacity-80">
                      Meaning: {point.translation}
                    </p>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <button 
          onClick={onCancel}
          className="absolute top-6 left-6 p-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/20 transition-all z-20 cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4 text-gray-400" />
        </button>

        <button 
          onClick={onSkip}
          className="absolute top-7 right-6 px-2.5 py-1 rounded-full bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all z-20 group cursor-pointer"
        >
          <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-gray-500 group-hover:text-gray-400 transition-colors">Skip</span>
        </button>

        <div className="text-left mb-6">
          <h2 className="text-[18px] w-[160px] ml-[39px] mt-0 mb-0 font-black italic tracking-tighter uppercase leading-tight">
            Type the Chant!
          </h2>
          
          <div className="mt-4 relative bg-gradient-to-br from-white/5 to-white/[0.02] rounded-[24px] border border-white/10 overflow-hidden mx-4 shadow-2xl backdrop-blur-sm group">
            <div className={`absolute inset-0 bg-primary/5 transition-opacity duration-500 ${showHint ? 'opacity-100' : 'opacity-0'}`} />
            
            <div className={`p-6 transition-all duration-700 ease-out flex items-center justify-center min-h-[100px] ${
              showHint ? 'blur-0 opacity-100 scale-100' : 'blur-2xl opacity-10 select-none scale-110'
            }`}>
              <div className="flex items-center justify-center gap-x-3 w-full text-center mt-0 ml-0 pt-0 whitespace-nowrap px-8 overflow-hidden">
                {point.textList.map((t: string, i: number) => (
                  <span key={i} className="text-xl sm:text-2xl font-black text-white italic uppercase tracking-tighter leading-none drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)] flex-shrink-0">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            
            <button 
              onClick={() => setShowHint(!showHint)}
              className="absolute top-1/2 -translate-y-1/2 right-4 p-2.5 bg-white/5 hover:bg-primary/20 backdrop-blur-md rounded-full border border-white/10 flex items-center justify-center transition-all z-10 hover:scale-110 active:scale-95 cursor-pointer"
              title={showHint ? 'Hide' : 'Show Chant'}
            >
              {showHint ? <EyeOff className="w-4 h-4 text-gray-400" /> : <Eye className="w-4 h-4 text-primary" />}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <input 
              autoFocus
              type="text" 
              placeholder="Type the chant here..."
              className={`w-full p-5 bg-white/5 border rounded-2xl outline-none transition-all text-center font-bold tracking-tight text-lg shadow-inner ${
                error ? 'border-red-500 bg-red-500/5' : 'border-white/10 focus:border-primary/50 focus:bg-white/10'
              }`}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
            />
            {error && (
              <div className="text-center mt-2 text-[10px] text-red-500 font-bold uppercase tracking-widest animation-pulse">
                Doesn't match! Try again.
              </div>
            )}
          </div>
          <button 
            onClick={handleTextSubmit}
            className="w-full py-5 bg-gradient-kpop text-white font-black tracking-[0.2em] rounded-2xl shadow-[0_10px_20px_rgba(233,64,87,0.3)] uppercase active:scale-95 transition-all text-sm cursor-pointer"
          >
            Confirm Hit
          </button>
        </div>
      </div>
    </motion.div>
  );
}


// --- Lyrics learning view (/lyrics/:songId) ---
function LyricsLearningView({ song, onBack, onGoPlayer }: { song: Song; onBack: () => void; onGoPlayer: () => void; key?: string }) {
  // Difficulty levels
  const levels = ['L1', 'L2', 'L3', 'L4'];
  
  // States
  const [selectedLevel, setSelectedLevel] = useState<string>(() => {
    const savedLevel = localStorage.getItem('selected_lyric_level');
    return savedLevel && ['L1', 'L2', 'L3', 'L4'].includes(savedLevel) ? savedLevel : 'L1';
  });
  const [tabMode, setTabMode] = useState<'lines' | 'words'>('words');
  const [analyses, setAnalyses] = useState<LyricLineAnalysis[]>([]);
  const [words, setWords] = useState<LyricWord[]>([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [isCloudData, setIsCloudData] = useState(false);

  // Persistence
  const handleLevelChange = (newLevel: string) => {
    setSelectedLevel(newLevel);
    localStorage.setItem('selected_lyric_level', newLevel);
  };

  // Load analysis and words data for this song
  useEffect(() => {
    const loadAnalysisData = async () => {
      setDbLoading(true);
      try {
        // Fetch lyric lines detailed analyses
        const { data: rawAnalyses, error: analysesError } = await supabase
          .from('lyric_line_analysis')
          .select('*')
          .eq('song_id', song.songId);

        // Fetch core vocabulary list
        const { data: rawWords, error: wordsError } = await supabase
          .from('lyric_words')
          .select('*')
          .eq('song_id', song.songId);

        if (analysesError || wordsError) {
          throw analysesError || wordsError;
        }

        setAnalyses(rawAnalyses || []);
        setWords(rawWords || []);
        setIsCloudData(Boolean(rawAnalyses && rawAnalyses.length > 0));
      } catch (err) {
        console.error("鍔犺浇澶辫触", err);
        setAnalyses([]);
        setWords([]);
        setIsCloudData(false);
      } finally {
        setDbLoading(false);
      }
    };

    loadAnalysisData();
  }, [song.songId]);

  // Filters computed based on selected Level
  const currentAnalyses = useMemo(() => {
    return getUniqueLineAnalyses(
      analyses.filter(a =>
        a.level.toUpperCase() === selectedLevel.toUpperCase() &&
        hasLineAnalysisContent(a)
      )
    );
  }, [analyses, selectedLevel]);

  const currentWords = useMemo(() => {
    return words.filter(w => w.level.toUpperCase() === selectedLevel.toUpperCase());
  }, [words, selectedLevel]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex flex-col bg-bg-dark text-white relative h-screen overflow-hidden z-10"
    >
      {/* Visual background glow */}
      <div 
        className="absolute inset-0 opacity-10 blur-3xl pointer-events-none scale-150"
        style={{ backgroundImage: `url(${song.coverImg})`, backgroundSize: 'cover' }}
      />

      <div className="relative z-10 flex-1 flex flex-col p-6 overflow-hidden">
        {/* Navigation bar */}
        <header className="flex items-center justify-between mb-5">
          <button onClick={onBack} className="w-11 h-11 rounded-full bg-white/70 border border-slate-200 shadow-sm flex items-center justify-center hover:bg-white transition-colors cursor-pointer">
            <ChevronLeft className="w-5 h-5 text-slate-800" />
          </button>
          
          <div className="text-center flex-1 mx-3 min-w-0">
            <h1 className="text-xl font-black italic tracking-tight uppercase text-slate-950 truncate">{song.songName}</h1>
          </div>

          <button
            onClick={onGoPlayer}
            className="w-11 h-11 rounded-full bg-gradient-kpop text-white shadow-[0_10px_24px_rgba(189,67,98,0.28)] flex items-center justify-center active:scale-95 transition-transform cursor-pointer"
            title="完整歌词跟听"
          >
            <Headphones className="w-5 h-5" />
          </button>
        </header>


        {/* Difficulty selection */}
        <div className="mb-5">
          <p className="text-[10px] font-bold text-gray-500 tracking-[0.14em] mb-2 text-center">难度选择</p>
          <div className="flex items-center justify-between gap-1 bg-white/5 border border-white/5 p-1 rounded-2xl max-w-sm mx-auto">
            {levels.map((lvl) => {
              const active = selectedLevel === lvl;
              return (
                <button
                  key={lvl}
                  onClick={() => handleLevelChange(lvl)}
                  className={`flex-1 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                    active 
                      ? 'bg-gradient-kpop text-white shadow-lg' 
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {lvl}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab selector for analyses lines vs keywords */}
        <div className="flex items-center justify-stretch border-b border-white/10 mb-5 max-w-md mx-auto w-full">
          <button 
            onClick={() => setTabMode('words')}
            className={`flex-1 pb-3 text-center text-xs font-black border-b-2 uppercase tracking-wide cursor-pointer transition-all ${
              tabMode === 'words' 
                ? 'border-secondary text-secondary' 
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            核心单词 ({currentWords.length})
          </button>
          <button 
            onClick={() => setTabMode('lines')}
            className={`flex-1 pb-3 text-center text-xs font-black border-b-2 uppercase tracking-wide cursor-pointer transition-all ${
              tabMode === 'lines' 
                ? 'border-primary text-primary' 
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            歌词分析 ({currentAnalyses.length})
          </button>
        </div>

        {/* Content list (Scrollable) */}
        <div className="flex-1 overflow-y-auto px-1 scrollbar-hidden space-y-4 pb-5 custom-scrollbar">
          {dbLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-500 text-[10px] tracking-widest">正在加载内容...</p>
            </div>
          ) : tabMode === 'lines' ? (
            currentAnalyses.length === 0 ? (
              <div className="text-center py-16 px-4 bg-white/[0.02] border border-white/5 rounded-3xl">
                <Layers className="w-10 h-10 text-gray-600 mx-auto mb-3 opacity-40" />
                <h4 className="text-white font-black italic text-sm uppercase mb-1">暂无歌词分析</h4>
              </div>
            ) : (
              currentAnalyses.map((line) => (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={line.id || line.line_index}
                  className="bg-card-dark border border-white/5 rounded-3xl p-5 shadow-lg flex flex-col gap-4 relative overflow-hidden group hover:border-primary/30 transition-all"
                >
                  {/* Decorative tag */}
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-primary" />
                  
                  {/* Card Header & TTS */}
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-[10px] font-black font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                      Index {String(line.line_index).padStart(2, '0')}
                    </span>
                    
                    <button 
                      onClick={() => speakKorean(line.tts_text || line.original_ko)}
                      className="p-2 bg-primary/10 rounded-full hover:bg-primary text-primary hover:text-white transition-all cursor-pointer"
                      title="TTS Output (ko-KR)"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Ko Raw sentence */}
                  <div className="text-left">
                    <p className="text-xl font-black text-white italic tracking-tight">{line.original_ko}</p>
                  </div>

                  {/* Translations block */}
                  <div className="space-y-1.5 bg-white/5 rounded-2xl p-4 border border-white/5">
                    <div className="text-left">
                      <span className="text-[11px] tracking-wider font-bold text-primary">意译</span>
                      <p className="text-sm font-bold text-white mt-0.5">{line.natural_translation_zh}</p>
                    </div>
                    {line.literal_translation_zh && (
                      <div className="text-left border-t border-white/5 pt-1.5 mt-1.5">
                        <span className="text-[11px] tracking-wider font-bold text-gray-500">直译</span>
                        <p className="text-xs text-gray-300 mt-0.5">{line.literal_translation_zh}</p>
                      </div>
                    )}
                  </div>

                  {/* Breakdown words structure */}
                  {line.word_breakdown_json && line.word_breakdown_json.length > 0 && (
                    <div>
                      <span className="text-[11px] tracking-wider font-bold text-gray-500 block text-left mb-1.5">逐词拆解</span>
                      <div className="flex flex-wrap gap-2">
                        {line.word_breakdown_json.map((wd: any, wIdx) => (
                          <div 
                            key={wIdx} 
                            onClick={() => speakKorean(wd.surface)}
                            className="bg-white/5 hover:bg-primary/20 hover:border-primary/40 border border-white/5 rounded-xl px-2.5 py-1.5 flex flex-col items-center gap-0.5 cursor-pointer transition-all group"
                          >
                            <span className="text-xs font-black text-white italic">{wd.surface}</span>
                            {wd.pronunciation && (
                              <span className="text-[8px] text-primary/80 font-mono font-semibold lowercase">[{wd.pronunciation}]</span>
                            )}
                            <span className="text-[9px] text-gray-400 group-hover:text-primary font-bold">
                              {wd.pronunciation && wd.meaning_zh.startsWith('[') && wd.meaning_zh.includes(']')
                                ? wd.meaning_zh.substring(wd.meaning_zh.indexOf(']') + 1).trim()
                                : wd.meaning_zh}
                            </span>
                            {wd.part_of_speech && (
                              <span className="text-[7px] text-gray-500 border border-white/10 px-1 rounded-sm uppercase tracking-wide scale-90">{wd.part_of_speech}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Grammar Phrase Notes */}
                  {line.grammar_note_zh && (
                    <div className="text-left bg-white/5 border border-white/5 rounded-2xl p-3.5 flex gap-2.5 items-start">
                      <HelpCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-[9px] uppercase tracking-wider font-extrabold text-primary">閺傚洦纭剁拠锕佇?/ grammar Description</span>
                        <p className="text-xs text-gray-300 leading-relaxed mt-0.5">{line.grammar_note_zh}</p>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))
            )
          ) : (
            currentWords.length === 0 ? (
              <div className="text-center py-16 px-4 bg-white/[0.02] border border-white/5 rounded-3xl">
                <Star className="w-10 h-10 text-gray-600 mx-auto mb-3 opacity-40" />
                <h4 className="text-white font-black italic text-sm uppercase mb-1">暂无核心单词</h4>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {currentWords.map((word) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={word.id || word.surface_form}
                    className="bg-card-dark border border-white/5 rounded-3xl p-5 hover:border-secondary/30 transition-all shadow-lg flex items-center justify-between gap-4"
                  >
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-lg font-black text-white italic">{word.surface_form}</span>
                        {word.pronunciation && (
                          <span className="text-xs text-secondary/80 font-mono font-semibold lowercase">[{word.pronunciation}]</span>
                        )}
                        {word.lemma && word.lemma !== word.surface_form && (
                          <span className="text-[9px] text-gray-500 font-bold font-mono">({word.lemma})</span>
                        )}
                        {word.part_of_speech && (
                          <span className="text-[8px] bg-secondary/15 text-secondary border border-secondary/20 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">{word.part_of_speech}</span>
                        )}
                      </div>
                      
                      <div className="flex flex-col gap-0.5">
                        <p className="text-base font-bold text-gray-200 leading-snug">
                          {word.pronunciation && word.meaning_zh.startsWith('[') && word.meaning_zh.includes(']')
                            ? word.meaning_zh.substring(word.meaning_zh.indexOf(']') + 1).trim()
                            : word.meaning_zh}
                        </p>
                        {word.form_note_zh && (
                          <span className="text-xs leading-snug text-[#8f7b99] font-black mt-1.5">{word.form_note_zh}</span>
                        )}
                      </div>
                    </div>

                    <button 
                      onClick={() => speakKorean(word.surface_form)}
                      className="p-3 bg-secondary/10 rounded-full hover:bg-secondary text-secondary hover:text-white transition-all cursor-pointer"
                      title="TTS Pronounce"
                    >
                      <Volume2 className="w-4.5 h-4.5" />
                    </button>
                  </motion.div>
                ))}
              </div>
            )
          )}
        </div>

      </div>
    </motion.div>
  );
}


// --- 7. NEW VIEW: DYNAMIC TRACKER PLAYER LYRICS (/lyrics/:songId/player) ---
function LyricsPlayerView({ song, onBack }: { song: Song; onBack: () => void; key?: string }) {
  // Audio playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioLoading, setAudioLoading] = useState(true);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [lyricsExpanded, setLyricsExpanded] = useState(false);

  // Segment looping / autoplay limits
  const [playingSegment, setPlayingSegment] = useState<{ start: number; end: number } | null>(null);

  // List of raw lyrics compiled from LRC
  const rawLrcLines = useMemo(() => parseLrc(song.lyrics || ""), [song.lyrics]);

  // Combined analyzed lines for detailed display
  const [analyses, setAnalyses] = useState<LyricLineAnalysis[]>([]);

  // Refs
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Parse LRC list and calculate duration ranges
  const detailedLrcLines = useMemo(() => {
    return rawLrcLines.map((line, idx) => {
      const nextLine = rawLrcLines[idx + 1];
      const endTime = nextLine ? nextLine.time : (duration || line.time + 5);
      return {
        index: idx + 1, // 1-based index matching line_index in DB
        time: line.time,
        endTime: endTime,
        text: line.text
      };
    });
  }, [rawLrcLines, duration]);

  // Fetch analyzed detailed entries
  useEffect(() => {
    const fetchA = async () => {
      try {
        const { data } = await supabase
          .from('lyric_line_analysis')
          .select('*')
          .eq('song_id', song.songId);
        
        if (data && data.length > 0) {
          setAnalyses(data);
        }
      } catch (err) {
        console.error('鍔犺浇澶辫触', err);
        setAnalyses([]);
      }
    };
    fetchA();
  }, [song.songId]);

  // Active line index tracker
  const activeLineIndex = useMemo(() => {
    let index = -1;
    for (let i = 0; i < detailedLrcLines.length; i++) {
      if (currentTime >= detailedLrcLines[i].time) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }, [detailedLrcLines, currentTime]);

  // Retrieve active lyric row model
  const activeLrcLineModel = activeLineIndex !== -1 ? detailedLrcLines[activeLineIndex] : null;

  // Retrieve active analysis profile (database mapped)
  const activeAnalysisModel = useMemo(() => {
    if (!activeLrcLineModel) return null;
    const matchedAnalysis = analyses.find(a => a.line_index === activeLrcLineModel.index) || null;
    return hasLineAnalysisContent(matchedAnalysis) ? matchedAnalysis : null;
  }, [analyses, activeLrcLineModel]);

  // Smooth centering active scroll element
  useEffect(() => {
    if (activeLineIndex !== -1 && scrollContainerRef.current) {
      const activeEl = itemRefs.current[activeLineIndex];
      if (activeEl) {
        const container = scrollContainerRef.current;
        const top = activeEl.offsetTop - (container.offsetHeight / 2) + (activeEl.offsetHeight / 2);
        container.scrollTo({ top, behavior: 'smooth' });
      }
    }
  }, [activeLineIndex]);

  // Audio playing sync loop
  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const time = e.currentTarget.currentTime;
    setCurrentTime(time);

    // Watch segment limit loops
    if (playingSegment) {
      if (time >= playingSegment.end) {
        if (audioRef.current) {
          audioRef.current.pause();
          setIsPlaying(false);
        }
        setPlayingSegment(null);
      }
    }
  };

  const handlePlayActiveLine = () => {
    if (!audioRef.current || !activeLrcLineModel) return;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    const endTime = activeLrcLineModel.endTime > activeLrcLineModel.time
      ? activeLrcLineModel.endTime
      : activeLrcLineModel.time + 5;

    setPlayingSegment({ start: activeLrcLineModel.time, end: endTime });
    audioRef.current.currentTime = activeLrcLineModel.time;
    setCurrentTime(activeLrcLineModel.time);

    const playPromise = audioRef.current.play();
    if (playPromise !== undefined) {
      playPromise.then(() => setIsPlaying(true)).catch(() => {});
    } else {
      setIsPlaying(true);
    }
  };

  // Basic player commands
  const handlePlayPause = () => {
    if (!audioRef.current) return;
    setPlayingSegment(null); // Clear active segments constraints
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.then(() => setIsPlaying(true)).catch(() => {});
      } else {
        setIsPlaying(true);
      }
    }
  };

  const handleSeek = (offset: number) => {
    if (!audioRef.current) return;
    setPlayingSegment(null);
    audioRef.current.currentTime += offset;
  };

  const handleSeekToLine = (line: any) => {
    if (!audioRef.current) return;
    setPlayingSegment(null);
    audioRef.current.currentTime = line.time;
    setCurrentTime(line.time);
    setLyricsExpanded(false);
    if (isPlaying) {
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.then(() => setIsPlaying(true)).catch(() => {});
      } else {
        setIsPlaying(true);
      }
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`flex-1 flex flex-col bg-bg-dark text-white relative h-screen overflow-hidden z-10 lyrics-player-page ${lyricsExpanded ? 'lyrics-list-open' : 'lyrics-list-closed'}`}
    >
      <div className="relative z-10 flex-1 flex flex-col md:flex-row h-full overflow-hidden">
        
        {/* Left column - Music Interface: Scrolling Lyrics & Seekers */}
        <div className="flex-1 flex flex-col p-6 border-r border-white/5 h-full overflow-hidden justify-between">
          <div>
            {/* Header */}
            <header className="flex items-center justify-between mb-4">
              <button onClick={onBack} className="p-3 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer">
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
              
              <div className="text-center">
                <h1 className="text-md font-black italic tracking-tighter uppercase text-white truncate max-w-[150px] inline-block">{song.songName}</h1>
                
              </div>
              
              <div className="w-11" />
            </header>
          </div>

          {/* Current lyric summary and expandable lyric list */}
          <div className="lyrics-picker px-2 py-4 relative">
            <button
              onClick={() => setLyricsExpanded((value) => !value)}
              className="lyrics-current-card w-full flex items-center gap-3 text-left rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 to-transparent p-4 shadow-[0_4px_20px_rgba(233,64,87,0.1)] cursor-pointer"
            >
              <span className="text-[10px] font-bold font-mono py-1 px-2 rounded bg-primary/20 text-primary flex-shrink-0">
                {formatTime((activeLrcLineModel || detailedLrcLines[0])?.time || 0)}
              </span>
              <span className="flex-1 min-w-0 text-sm font-black italic tracking-wide truncate text-white">
                {(activeLrcLineModel || detailedLrcLines[0])?.text || '等待歌词同步'}
              </span>
              {lyricsExpanded ? (
                <ChevronUp className="w-5 h-5 text-primary flex-shrink-0" />
              ) : (
                <ChevronDown className="w-5 h-5 text-primary flex-shrink-0" />
              )}
            </button>

            <AnimatePresence>
              {lyricsExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div
                    ref={scrollContainerRef}
                    className="lyrics-expanded-list mt-3 overflow-y-auto px-1 space-y-2 scrollbar-hidden custom-scrollbar max-h-[300px] md:max-h-[420px]"
                  >
                    {detailedLrcLines.map((line, idx) => {
                      const isActive = activeLineIndex === idx;
                      return (
                        <button
                          key={idx}
                          ref={(el) => { itemRefs.current[idx] = el; }}
                          onClick={() => handleSeekToLine(line)}
                          className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border transition-all duration-300 cursor-pointer text-left ${
                            isActive
                              ? 'bg-gradient-to-r from-primary/10 to-transparent border-primary/20 scale-[1.01] shadow-[0_4px_20px_rgba(233,64,87,0.1)]'
                              : 'bg-white/[0.02] border-transparent opacity-55 hover:opacity-100 hover:bg-white/5'
                          }`}
                        >
                          <span className={`text-[10px] font-bold font-mono py-0.5 px-1.5 rounded flex-shrink-0 ${isActive ? 'bg-primary/20 text-primary' : 'bg-white/5 text-gray-500'}`}>
                            {formatTime(line.time)}
                          </span>
                          <span className={`text-sm font-black italic tracking-wide line-clamp-2 ${isActive ? 'text-white' : 'text-gray-400'}`}>
                            {line.text}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* Controls Footer */}
          <div className="mt-4 pt-4 border-t border-white/5 bg-accent-dark/20 p-4 rounded-3xl">
            {audioError && <p className="text-[10px] text-red-500 font-bold mb-3">{audioError}</p>}
            
            <div className="flex items-center gap-4 mb-4">
              <span className="text-[9px] font-mono text-gray-500 w-10 text-right">{formatTime(currentTime)}</span>
              <div className="flex-1 h-1.5 bg-white/5 rounded-full relative cursor-pointer">
                <div 
                  className="absolute top-0 left-0 h-full bg-gradient-kpop rounded-full"
                  style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                />
                <input 
                  type="range"
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  min={0}
                  max={duration || 0}
                  value={currentTime}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (audioRef.current) audioRef.current.currentTime = v;
                    setCurrentTime(v);
                  }}
                />
              </div>
              <span className="text-[9px] font-mono text-gray-500 w-10">{formatTime(duration)}</span>
            </div>

            <div className="flex items-center justify-center gap-6">
              <button onClick={() => handleSeek(-5)} className="p-3 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors cursor-pointer">
                <RotateCcw className="w-5 h-5" />
              </button>
              
              <button 
                onClick={handlePlayPause}
                className="w-14 h-14 bg-gradient-kpop text-white rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                {audioLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-6 h-6 fill-white text-white" />
                ) : (
                  <Play className="w-6 h-6 fill-white text-white ml-0.5" />
                )}
              </button>

              <button onClick={() => handleSeek(5)} className="p-3 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors cursor-pointer">
                <RotateCw className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right column - Lyrics detailed interactive analysis for the active line */}
        <div className="w-full md:w-[380px] p-6 bg-accent-dark/20 border-t md:border-t-0 md:border-l border-white/5 h-full overflow-y-auto custom-scrollbar">
          <h2 className="text-[13px] font-black text-gray-500 tracking-[0.08em] mb-4 text-left">鍙ュ瓙娣卞害鍒嗘瀽</h2>
          
          <AnimatePresence mode="wait">
            {!activeAnalysisModel ? (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="p-8 text-center flex flex-col items-center justify-center gap-3 border border-white/5 rounded-3xl h-full min-h-[160px]"
              >
                <Layers className="w-8 h-8 text-gray-700 animate-pulse" />
                <p className="text-gray-500 text-xs tracking-wide">播放歌曲或选择歌词，本栏会同步显示这一句的解析</p>
              </motion.div>
            ) : (
              <motion.div 
                key={activeAnalysisModel.line_index}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-5 text-left"
              >
                {/* original, translation, speech button */}
                <div className="sentence-profile-card bg-card-dark rounded-3xl p-5 border border-white/10 relative overflow-hidden">
                  <div className="sentence-profile-top">
                    <div className="min-w-0 pr-12">
                      <span className="sentence-profile-label text-primary font-black">??</span>
                      <p className="sentence-profile-korean text-lg font-black text-white italic tracking-tight leading-tight mt-2">{activeAnalysisModel.original_ko}</p>
                    </div>
                    <button 
                      onClick={handlePlayActiveLine}
                      className="sentence-profile-speak p-2 bg-primary/10 rounded-full hover:bg-primary text-primary hover:text-white transition-all cursor-pointer"
                      title="播放当前句原曲"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="sentence-profile-body">
                    <div className="sentence-translation-block sentence-translation-natural">
                      <span className="sentence-profile-label text-gray-500 font-extrabold">??</span>
                      <p className="sentence-profile-natural text-sm font-bold text-white mt-1">{activeAnalysisModel.natural_translation_zh}</p>
                    </div>
                    {activeAnalysisModel.literal_translation_zh && (
                      <div className="sentence-translation-block sentence-translation-literal">
                        <span className="sentence-profile-label text-gray-500 font-extrabold">??</span>
                        <p className="sentence-profile-literal text-xs text-gray-400 mt-1">{activeAnalysisModel.literal_translation_zh}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* dynamic breakdown chips */}
                {activeAnalysisModel.word_breakdown_json && activeAnalysisModel.word_breakdown_json.length > 0 && (
                  <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-5">
                    <span className="text-[8px] uppercase tracking-wider text-gray-500 font-extrabold block mb-3">逐词拆解 / Vocabulary breakdown</span>
                    <div className="flex flex-wrap gap-2">
                      {activeAnalysisModel.word_breakdown_json.map((wd: any, wIdx) => (
                        <div 
                          key={wIdx} 
                          onClick={() => speakKorean(wd.surface)}
                          className="bg-white/5 hover:bg-primary/20 border border-white/5 hover:border-primary/40 rounded-xl px-2.5 py-1.5 flex flex-col items-center gap-0.5 cursor-pointer transition-all group"
                        >
                          <span className="text-xs font-black text-white italic">{wd.surface}</span>
                          {wd.pronunciation && (
                            <span className="text-[8px] text-primary/80 font-mono font-semibold lowercase">[{wd.pronunciation}]</span>
                          )}
                          <span className="text-[9px] text-gray-400 group-hover:text-primary font-bold">
                            {wd.pronunciation && wd.meaning_zh.startsWith('[') && wd.meaning_zh.includes(']')
                              ? wd.meaning_zh.substring(wd.meaning_zh.indexOf(']') + 1).trim()
                              : wd.meaning_zh}
                          </span>
                          {wd.part_of_speech && (
                            <span className="text-[7.5px] text-gray-500 scale-90 mt-0.5">{wd.part_of_speech}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* grammar detail note card */}
                {activeAnalysisModel.grammar_note_zh && (
                  <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-5 flex gap-3">
                    <HelpCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[11px] tracking-wider font-bold text-primary">意译</span>
                      <p className="text-xs text-gray-300 leading-relaxed mt-0.5">{activeAnalysisModel.grammar_note_zh}</p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>

      {/* Hidden system Audio entity */}
      <audio 
        ref={audioRef}
        src={song.audioUrl}
        preload="auto"
        crossOrigin="anonymous"
        onLoadStart={() => {
          setAudioLoading(true);
          setAudioError(null);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (d > 0 && !isNaN(d)) setDuration(d);
          setAudioLoading(false);
        }}
        onCanPlay={() => {
          setAudioLoading(false);
          if (audioRef.current && (duration === 0 || isNaN(duration))) {
            const d = audioRef.current.duration;
            if (d > 0 && !isNaN(d)) setDuration(d);
          }
        }}
        onPlaying={() => {
          setAudioLoading(false);
        }}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
        onError={(e) => {
          setAudioLoading(false);
          const errorCode = e.currentTarget.error?.code || 4;
          setAudioError(`音频资源暂时无法响应 (Code: ${errorCode})`);
        }}
      />
    </motion.div>
  );
}

// --- LRC subtitle parser helper ---
interface LrcLine {
  time: number;
  text: string;
}

function parseLrc(lrc: string): LrcLine[] {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const result: LrcLine[] = [];

  lines.forEach(line => {
    let match;
    const text = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();
    if (!text) return;

    const currentLineRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
    while ((match = currentLineRegex.exec(line)) !== null) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const milliseconds = parseInt(match[3]);
      const time = minutes * 60 + seconds + milliseconds / (match[3].length === 3 ? 1000 : 100);
      result.push({ time, text });
    }
  });

  return result.sort((a, b) => a.time - b.time);
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
