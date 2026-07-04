// Google Sheets fetcher. The user can publish each tab as CSV and add gids here.
// If a fetch fails, we fall back to defaults so the game still works.

const BASE_CSV =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQElPjDhDX1mDgYgdIITH_NDCbkE1SOJYAwYAbec0-Eou8EztiIDSS9zCHXD-b1TvXETgWKvZzpQth2/pub?output=csv";

// Per-sheet GIDs — each value is the `gid` of a tab in the published spreadsheet.
//
// HOW TO FIND A TAB GID (langkah-langkah):
// 1) Buka Google Spreadsheet → klik tab yang dimaksud (mis. "Roles").
// 2) Lihat URL browser, contoh:
//      https://docs.google.com/spreadsheets/d/XXXX/edit#gid=1706298822
//    Angka setelah `gid=` itulah GID tab tersebut.
// 3) Pastikan File → Share → Publish to web sudah aktif (Entire document, CSV).
// 4) Tempelkan angka GID ke object di bawah ini sebagai string.
//
// GIDs yang sudah dikonfigurasi (sesuai spreadsheet aktif):
const GIDS: Record<string, string | null> = {
  Localization: "0",
  Roles: "1706298822",
  Venues: "927374032",
  Spots: "1097504508",
  GameStatus: "1954201625",
};

// Build the published-CSV URL for a given tab. The base URL already targets
// the first tab, so when a GID is provided we append it as a query param.
function urlFor(name: string) {
  const gid = GIDS[name];
  if (!gid) return BASE_CSV;
  const sep = BASE_CSV.includes("?") ? "&" : "?";
  return `${BASE_CSV}${sep}gid=${gid}`;
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* ignore */ }
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(v => v.trim().length));
}

async function fetchSheet(name: string): Promise<string[][] | null> {
  try {
    const res = await fetch(urlFor(name), { cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    const rows = parseCSV(text);
    if (rows.length < 2) return null;
    return rows.slice(1); // drop header
  } catch {
    return null;
  }
}

// Defaults (Indonesian / Javanese flavor)
const DEFAULTS = {
  localization: {
    app_title: "TEKONGAN",
    app_subtitle: "Petak Umpet Jowo Timuran",
    gateway_title: "GERBANG RAHASIA",
    gateway_hint: "Lebokno kode rahasia kanggo mlebu",
    gateway_btn: "Mlebu",
    gateway_wrong: "Kode salah, coba maneh!",
    btn_create: "Gawe Room",
    btn_join: "Mlebu Room",
    btn_start: "Mulai Permainan",
    btn_leave: "Metu",
    btn_share: "Share Room",
    btn_tekong: "TEKONG!",
    msg_merem: "MEREM... ojo ngintip!",
    msg_hiding: "Cepet singitan!",
    msg_searching: "Penjaga lagi nggoleki...",
    msg_match: "Ono sing singitan kene!",
    msg_safe: "SLAMET!",
    msg_caught: "KENA TEKONG!",
    msg_trap: "JEBAKAN! Kelangan nyawa.",
    msg_empty: "Kosong! Kelangan nyawa.",
    msg_min_players: "Pemain kurang dari 3, permainan berakhir!",
    msg_danger: "SISA SIJI! BAHAYA!",
    label_host: "Host",
    label_venue: "Tempat",
    label_players: "Pemain",
    label_lives: "Nyawa",
    label_chat: "Obrolan",
    placeholder_name: "Jenengmu",
    placeholder_room: "Kode Room",
    placeholder_chat: "Tulis pesen...",
    footer: "Dikembangkan oleh Arsepat",
    results_title: "HASIL TEKONGAN",
  } as Record<string, string>,
  roles: [
    { id: "seeker", name: "Penjaga" },
    { id: "hider", name: "Pemain" },
  ],
  venues: [
    { id: "kampung", name: "Kampung" },
    { id: "sekolah", name: "Sekolahan" },
    { id: "sawah", name: "Pinggir Sawah" },
  ],
  spots: [
    // kampung
    { id: "k1", venueId: "kampung", text: "🌳 Wit Gedhang" },
    { id: "k2", venueId: "kampung", text: "🏠 Mburi Omah" },
    { id: "k3", venueId: "kampung", text: "🚪 Pawon" },
    { id: "k4", venueId: "kampung", text: "🪣 Sumur" },
    { id: "k5", venueId: "kampung", text: "🏍️ Mburi Motor" },
    { id: "k6", venueId: "kampung", text: "🌿 Suket Dawa" },
    { id: "k7", venueId: "kampung", text: "🪵 Tumpukan Kayu" },
    { id: "k8", venueId: "kampung", text: "🚜 Mburi Gerobak" },
    // sekolah
    { id: "s1", venueId: "sekolah", text: "📚 Perpus" },
    { id: "s2", venueId: "sekolah", text: "🚽 WC" },
    { id: "s3", venueId: "sekolah", text: "🏀 Lapangan" },
    { id: "s4", venueId: "sekolah", text: "🪑 Kelas Kosong" },
    { id: "s5", venueId: "sekolah", text: "🌳 Wit Mangga" },
    { id: "s6", venueId: "sekolah", text: "🚪 Mburi UKS" },
    { id: "s7", venueId: "sekolah", text: "🍱 Kantin" },
    { id: "s8", venueId: "sekolah", text: "🪜 Tangga" },
    // sawah
    { id: "w1", venueId: "sawah", text: "🌾 Galengan" },
    { id: "w2", venueId: "sawah", text: "🐃 Cedhak Kebo" },
    { id: "w3", venueId: "sawah", text: "🪨 Watu Gedhe" },
    { id: "w4", venueId: "sawah", text: "🌿 Suket Garing" },
    { id: "w5", venueId: "sawah", text: "🎋 Pring Petung" },
    { id: "w6", venueId: "sawah", text: "🛖 Gubuk" },
    { id: "w7", venueId: "sawah", text: "💧 Kalen" },
    { id: "w8", venueId: "sawah", text: "🌳 Wit Asem" },
  ],
  gameStatus: {
    safe: "Slamet",
    caught: "Kena Tekong",
    waiting: "Lagi Singitan",
  } as Record<string, string>,
};

export type GameContent = {
  t: (key: string) => string;
  roles: { id: string; name: string }[];
  venues: { id: string; name: string }[];
  spots: { id: string; venueId: string; text: string }[];
  status: Record<string, string>;
};

const CACHE_KEY = "tekongan_content_cache_v2";

type CachedPayload = {
  localization: Record<string, string>;
  roles: GameContent["roles"];
  venues: GameContent["venues"];
  spots: GameContent["spots"];
  status: Record<string, string>;
};

function readCache(): CachedPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedPayload) : null;
  } catch { return null; }
}
function writeCache(p: CachedPayload) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
function fromPayload(p: CachedPayload): GameContent {
  return {
    t: (k: string) => p.localization[k] ?? k,
    roles: p.roles, venues: p.venues, spots: p.spots, status: p.status,
  };
}

export async function loadContent(): Promise<GameContent> {
  try {
    const [loc, roles, venues, spots, status] = await Promise.all([
      fetchSheet("Localization"),
      fetchSheet("Roles"),
      fetchSheet("Venues"),
      fetchSheet("Spots"),
      fetchSheet("GameStatus"),
    ]);

    const localization = { ...DEFAULTS.localization };
    if (loc) for (const r of loc) if (r[0]) localization[r[0].trim()] = (r[1] ?? "").trim();

    const rolesArr = roles?.length
      ? roles.map(r => ({ id: r[0]?.trim(), name: (r[1] ?? "").trim() })).filter(r => r.id)
      : DEFAULTS.roles;

    const venuesArr = venues?.length
      ? venues.map(r => ({ id: r[0]?.trim(), name: (r[1] ?? "").trim() })).filter(r => r.id)
      : DEFAULTS.venues;

    const spotsArr = spots?.length
      ? spots.map(r => ({ id: r[0]?.trim(), venueId: r[1]?.trim(), text: (r[2] ?? "").trim() }))
          .filter(s => s.id && s.venueId)
      : DEFAULTS.spots;

    const statusObj = { ...DEFAULTS.gameStatus };
    if (status) for (const r of status) if (r[0]) statusObj[r[0].trim()] = (r[1] ?? "").trim();

    const payload: CachedPayload = {
      localization, roles: rolesArr, venues: venuesArr, spots: spotsArr, status: statusObj,
    };
    writeCache(payload);
    return fromPayload(payload);
  } catch {
    // Offline / fetch failure — fall back to last cached content, then defaults.
    const cached = readCache();
    if (cached) return fromPayload(cached);
    return fromPayload({
      localization: DEFAULTS.localization,
      roles: DEFAULTS.roles,
      venues: DEFAULTS.venues,
      spots: DEFAULTS.spots,
      status: DEFAULTS.gameStatus,
    });
  }
}
