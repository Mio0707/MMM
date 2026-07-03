import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SONG_ORDER = [
  'Mr.Aimeimohu01',
  'Destiny01',
  'No More Drama01',
  'Egotistic01',
  '4x4ever01',
  'My star01',
  'Piano man01',
  'Decalcomanie01',
  'I Miss You01',
  'Rainy Season01',
  'Starry night01',
  '1cm-525c55f2',
  'song-9a7b21cb',
  'song-b917a87d',
  'Waggy01',
  'newyork-c55461af',
  'freakin-shoes-90b1b97c',
  'Recipe01',
  'baton-touch-bc1b0813',
  'so-cute-c62e3c62',
  'the-symphony-of-fxxkboys-c7941ddc',
  'hertz-fd1dc563',
  'blues-fcff5b9f',
  'song-2367b354',
  'song-f47b58aa',
  '4-flowers-f810c799',
  'aya-04651a9a',
  'illella-8ea471a9',
  'hip-001',
  'dingga-245b9c9e',
  'Gogobebe01',
  'Wind flower-001',
  'You Is Mind01',
  'Yes I am01',
  'Better01',
  'Um Oh Ah Yeah01',
];

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { error: resetError } = await supabase
    .from('songs')
    .update({ sort_order: null })
    .not('songId', 'in', `(${SONG_ORDER.map((id) => `"${id}"`).join(',')})`);
  if (resetError) throw resetError;

  for (const [index, songId] of SONG_ORDER.entries()) {
    const { error } = await supabase
      .from('songs')
      .update({ sort_order: (index + 1) * 10 })
      .eq('songId', songId);
    if (error) throw error;
  }

  const { data, error } = await supabase
    .from('songs')
    .select('songId,songName,sort_order')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('songName', { ascending: true });
  if (error) throw error;

  console.table(data);
}

main().catch((error: any) => {
  console.error(`ERROR: ${error.message || error}`);
  process.exit(1);
});
