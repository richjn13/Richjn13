// Copy to web/config.js and fill in. config.js is gitignored: the anon key is
// safe in a browser (row-level security is what protects the data, not this
// key), but keeping it out of the repo means one less thing to rotate if the
// repo ever goes public.
window.MP_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
  aiEndpoint: '/api/ai'
};
