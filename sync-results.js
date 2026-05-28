// Vercel Cron Function – läuft automatisch alle 5 Minuten
// Datei: /api/sync-results.js
// Holt Ergebnisse von openfootball GitHub und aktualisiert Supabase

const SUPABASE_URL = 'https://bmlynctfdiwcaqcpsusw.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WC_JSON = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

export default async function handler(req, res) {
  // Nur Cron oder manuell
  const authHeader = req.headers['authorization'];
  if (req.method !== 'GET') return res.status(405).end();

  try {
    // 1. WM-Daten von GitHub holen
    const wcRes = await fetch(WC_JSON);
    const wcData = await wcRes.json();
    const matches = wcData.matches.filter(m => m.score?.ft);

    if (matches.length === 0) {
      return res.json({ message: 'Noch keine Ergebnisse verfügbar', synced: 0 });
    }

    // 2. Alle Spiele aus Supabase laden
    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/matches?select=id,home_team,away_team,is_finished`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    const dbMatches = await dbRes.json();

    let synced = 0;

    // 3. Für jedes Spiel mit Ergebnis: in DB updaten
    for (const m of matches) {
      const [homeScore, awayScore] = m.score.ft;

      // Team-Namen abgleichen (normalisiert)
      const dbMatch = dbMatches.find(db =>
        normalize(db.home_team) === normalize(m.team1) &&
        normalize(db.away_team) === normalize(m.team2)
      );

      if (!dbMatch || dbMatch.is_finished) continue;

      // Update in Supabase (Trigger berechnet automatisch Punkte)
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/matches?id=eq.${dbMatch.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          home_score: homeScore,
          away_score: awayScore,
          is_finished: true,
          last_synced: new Date().toISOString()
        })
      });

      if (updateRes.ok) synced++;
    }

    return res.json({ message: `${synced} Spiele aktualisiert`, total_with_results: matches.length });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

function normalize(name) {
  return (name || '').toLowerCase()
    .replace(/ü/g,'u').replace(/ö/g,'o').replace(/ä/g,'a')
    .replace(/[^a-z0-9]/g,' ').trim();
}
