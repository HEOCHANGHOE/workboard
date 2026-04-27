// Work Board cloud configuration.
//
// 1. Create a Supabase project.
// 2. Enable Google as an Auth provider in Supabase.
// 3. Add your GitHub Pages URL to Supabase Auth redirect URLs.
// 4. Replace the placeholder values below.
//
// The anon key is safe to ship in a browser app when Row Level Security is enabled.
window.WORK_BOARD_CONFIG = {
  supabaseUrl: 'https://zsysapxopcxaqvxaqpxe.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzeXNhcHhvcGN4YXF2eGFxcHhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzAyMjAsImV4cCI6MjA5MjgwNjIyMH0.RWLLGFg8pUwU0RYbojj5M_ZDPx4JRYBcNkZamFsdFow',
  redirectUrl: window.location.origin + window.location.pathname
};
