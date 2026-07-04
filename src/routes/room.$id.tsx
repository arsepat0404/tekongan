import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ContentProvider, useContent } from "@/components/ContentProvider";
import { Footer } from "@/components/Footer";
import { ChatPanel } from "@/components/ChatPanel";
import { isAuthorized, getPlayerId, getPlayerName, setPlayerName, vibrate } from "@/lib/player";
import { supabase } from "@/integrations/supabase/client";
import { sfx, initAudio, isMuted, setMuted } from "@/lib/sfx";
import {
  joinRoom, leaveRoom, startGame, advanceToSearching, endRoom,
  pickHidingSpot, seekerPick, tapDuel, resolveDuel, playAgain,
} from "@/lib/game.functions";
import { Heart, Share2, Copy, LogOut, Play, Eye, EyeOff, Crown, Skull, Shield, Loader2, Wifi, Volume2, VolumeX, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/room/$id")({
  head: () => ({ meta: [{ title: "Room — Tekongan" }] }),
  component: () => <ContentProvider><RoomScreen /></ContentProvider>,
});

// ---- Intro overlay timing (tune here) -----------------------------------
// SHUFFLE_MS: lama "hom pim pa" name shuffle
// REVEAL_HOLD_MS: lama menampilkan nama penjaga sebelum countdown dimulai
// COUNTDOWN_FROM: angka mulai countdown (3 -> 3,2,1)
// COUNTDOWN_STEP_MS: jeda antar angka countdown
// Total ≈ SHUFFLE_MS + REVEAL_HOLD_MS + COUNTDOWN_FROM*COUNTDOWN_STEP_MS
// Harus sama dengan INTRO_TOTAL_MS di src/lib/game.functions.ts.
const SHUFFLE_MS = 3500;
const REVEAL_HOLD_MS = 2000;
const COUNTDOWN_FROM = 3;
const COUNTDOWN_STEP_MS = 1000;
const SHUFFLE_TICK_MS = 180;

type Room = {
  id: string; host_id: string; host_name: string;
  venue_id: string | null; venue_name: string | null;
  status: "lobby" | "hiding" | "searching" | "ended";
  seeker_id: string | null; seeker_lives: number;
  hiding_ends_at: string | null;
};
type Player = {
  id: string; room_id: string; player_id: string; name: string;
  role: "seeker" | "hider"; status: "waiting" | "hidden" | "safe" | "caught";
};
type Duel = {
  id: string; room_id: string; spot_id: string;
  seeker_id: string; hider_id: string;
  started_at: string;
  seeker_tapped_at: string | null; hider_tapped_at: string | null;
  winner_id: string | null;
};
type Emote = { id: string; player_id: string; emote: string };

// Pick 3 trap spot IDs deterministically from a room id
function pickTraps(roomId: string, spotIds: string[]): Set<string> {
  let h = 0;
  for (const c of roomId) h = (h * 31 + c.charCodeAt(0)) | 0;
  const sorted = [...spotIds];
  const traps = new Set<string>();
  for (let i = 0; i < 3 && sorted.length; i++) {
    const idx = Math.abs(h + i * 17) % sorted.length;
    traps.add(sorted[idx]);
    sorted.splice(idx, 1);
  }
  return traps;
}

function RoomScreen() {
  const { id } = Route.useParams();
  const { t, spots, status: stMap } = useContent();
  const nav = useNavigate();
  const pid = getPlayerId();

  const join$ = useServerFn(joinRoom);
  const leave$ = useServerFn(leaveRoom);
  const start$ = useServerFn(startGame);
  const advance$ = useServerFn(advanceToSearching);
  const end$ = useServerFn(endRoom);
  const pickHide$ = useServerFn(pickHidingSpot);
  const seekerPick$ = useServerFn(seekerPick);
  const tap$ = useServerFn(tapDuel);
  const resolve$ = useServerFn(resolveDuel);
  const playAgain$ = useServerFn(playAgain);

  const [myName, setMyName] = useState<string>(() => getPlayerName());
  const [nameDraft, setNameDraft] = useState<string>("");
  const needsName = !myName.trim();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [duel, setDuel] = useState<Duel | null>(null);
  const [emotePops, setEmotePops] = useState<Record<string, { emote: string; key: number }>>({});
  const emoteTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState(false);
  const [tekongPos, setTekongPos] = useState({ x: 50, y: 50 });
  const [tapped, setTapped] = useState(false);
  const tappedRef = useRef(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [intro, setIntro] = useState<
    | { phase: "shuffle"; shuffleName: string }
    | { phase: "reveal"; seekerName: string; countdown: number }
    | null
  >(null);
  // My own picked spot — server keeps the canonical record privately; we just
  // remember it locally for UI affordance (highlight + disable other cards).
  const [myHiddenSpot, setMyHiddenSpot] = useState<string | null>(null);

  // Bootstrap auth + audio
  useEffect(() => {
    if (!isAuthorized()) { nav({ to: "/", search: { redirect: id } }); return; }
    initAudio();
    setMutedState(isMuted());
  }, [nav]);

  // Tick
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, []);

  // Load + subscribe (only after name is set).
  const reloadRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (needsName) return;
    let alive = true;
    async function loadAll() {
      const [{ data: r }, { data: ps }, { data: ds }] = await Promise.all([
        supabase.from("rooms").select("*").eq("id", id).maybeSingle(),
        supabase.from("room_players").select("*").eq("room_id", id),
        supabase.from("duels").select("*").eq("room_id", id).is("winner_id", null)
          .order("started_at", { ascending: false }).limit(1),
      ]);
      if (!alive) return;
      if (!r) { toast.error("Room ora ono"); nav({ to: "/lobby" }); return; }
      setRoom(r as Room);
      setPlayers((ps ?? []) as unknown as Player[]);
      const active = (ds ?? [])[0] as Duel | undefined;
      if (active && (active.seeker_id === pid || active.hider_id === pid)) {
        setDuel(prev => prev?.id === active.id ? prev : active);
      }
      // Auto-join via server fn (validates room state + sanitizes name)
      if (!(ps ?? []).find((p) => p.player_id === pid)) {
        await join$({ data: { room_id: id, player_id: pid, name: myName } });
      }
    }
    reloadRef.current = loadAll;
    loadAll();

    const ch = supabase.channel(`room-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${id}` },
        (p) => setRoom(p.new as Room))
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${id}` },
        async () => {
          const { data } = await supabase.from("room_players").select("*").eq("room_id", id);
          setPlayers((data ?? []) as unknown as Player[]);
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "duels", filter: `room_id=eq.${id}` },
        (p) => {
          const d = p.new as Duel;
          if (d.seeker_id === pid || d.hider_id === pid) startDuel(d);
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "duels", filter: `room_id=eq.${id}` },
        (p) => {
          const d = p.new as Duel;
          setDuel(prev => prev && prev.id === d.id ? d : prev);
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "emotes", filter: `room_id=eq.${id}` },
        (p) => {
          const e = p.new as Emote;
          const prevTimer = emoteTimersRef.current[e.player_id];
          if (prevTimer) clearTimeout(prevTimer);
          setEmotePops(prev => ({ ...prev, [e.player_id]: { emote: e.emote, key: Date.now() } }));
          emoteTimersRef.current[e.player_id] = setTimeout(() => {
            setEmotePops(prev => {
              const n = { ...prev }; delete n[e.player_id]; return n;
            });
            delete emoteTimersRef.current[e.player_id];
          }, 1500);
        })
      .subscribe();

    async function resync() {
      setReconnecting(true);
      try { await reloadRef.current(); } finally {
        setTimeout(() => setReconnecting(false), 400);
      }
    }
    const onOnline = () => { resync(); toast("Tersambung maneh"); };
    const onVisible = () => { if (document.visibilityState === "visible") resync(); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      supabase.removeChannel(ch);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, nav, pid, myName, needsName, join$]);

  function submitName() {
    const v = nameDraft.trim().slice(0, 20);
    if (v.length < 2) { toast.error("Min. 2 huruf"); return; }
    setPlayerName(v);
    setMyName(v);
  }

  const me = players.find(p => p.player_id === pid);
  const isHost = room?.host_id === pid;
  const isSeeker = room?.seeker_id === pid;
  const hiders = players.filter(p => p.role === "hider");
  const aliveHiders = hiders.filter(p => p.status !== "caught" && p.status !== "safe");
  const allVenueSpots = useMemo(() => spots.filter(s => s.venueId === room?.venue_id), [spots, room?.venue_id]);
  const targetCount = Math.max(3, hiders.length + 3);
  const venueSpots = useMemo(() => allVenueSpots.slice(0, targetCount), [allVenueSpots, targetCount]);
  const traps = useMemo(() => pickTraps(id, venueSpots.map(s => s.id)), [id, venueSpots]);
  const dangerMode = room?.status === "searching" && aliveHiders.length === 1;

  // Reset local hidden-spot memory when a new round starts
  useEffect(() => {
    if (room?.status === "lobby" || room?.status === "hiding") {
      if (me?.status === "waiting") setMyHiddenSpot(null);
    }
  }, [room?.status, me?.status]);

  const hidingRemain = room?.hiding_ends_at ? Math.max(0, Math.ceil((new Date(room.hiding_ends_at).getTime() - now) / 1000)) : 0;
  const effectiveStatus: Room["status"] =
    room?.status === "hiding" && hidingRemain <= 0 ? "searching" : (room?.status ?? "lobby");

  // Advance hiding → searching via server fn (idempotent; retries if lagging)
  useEffect(() => {
    if (room?.status !== "hiding" || hidingRemain > 0) return;
    const fire = () => { advance$({ data: { room_id: id } }).catch(() => {}); };
    fire();
    const retry = setInterval(fire, 1500);
    return () => clearInterval(retry);
  }, [room?.status, hidingRemain, id, advance$]);

  // Auto-terminate if <3 mid-game
  useEffect(() => {
    if (!room || !isHost) return;
    if ((room.status === "hiding" || room.status === "searching") && players.length > 0 && players.length < 3) {
      end$({ data: { room_id: id } }).catch(() => {});
    }
  }, [players.length, room, isHost, id, end$]);

  useEffect(() => {
    if (room?.status === "ended" && players.length > 0 && players.length < 3) {
      toast.error(t("msg_min_players"));
      const tm = setTimeout(() => nav({ to: "/lobby" }), 1500);
      return () => clearTimeout(tm);
    }
  }, [room?.status, players.length, nav, t]);

  // End conditions
  useEffect(() => {
    if (!room || !isHost || room.status !== "searching") return;
    if (room.seeker_lives <= 0 || aliveHiders.length === 0) {
      end$({ data: { room_id: id } }).catch(() => {});
    }
  }, [room, aliveHiders.length, isHost, id, end$]);

  function startDuel(d: Duel) {
    setDuel(d);
    setTekongPos({ x: 15 + Math.random() * 70, y: 30 + Math.random() * 50 });
    setFlash(true);
    sfx.match();
    vibrate([100, 50, 100, 50, 200]);
    setTimeout(() => setFlash(false), 900);
    tappedRef.current = false;
    setTapped(false);
  }

  // Continuous "deg-degan" vibration + heartbeat sfx during an active duel,
  // until either I tap or the duel resolves. Both seeker & hider feel it.
  useEffect(() => {
    if (!duel || duel.winner_id) return;
    if (duel.seeker_id !== pid && duel.hider_id !== pid) return;
    if (tapped) return;
    const iv = setInterval(() => {
      vibrate([180, 120]);
      sfx.duelHeartbeat();
    }, 650);
    return () => clearInterval(iv);
  }, [duel, pid, tapped]);

  // Countdown beeps in the last 3s of hiding phase (seeker side)
  const lastBeepRef = useRef(0);
  useEffect(() => {
    if (room?.status !== "hiding") return;
    if (hidingRemain > 0 && hidingRemain <= 3 && lastBeepRef.current !== hidingRemain) {
      lastBeepRef.current = hidingRemain;
      sfx.countdown();
    }
  }, [hidingRemain, room?.status]);

  // Phase transitions → audio cues + intro overlay
  const prevStatusRef = useRef<Room["status"] | null>(null);
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (room?.status && prev && prev !== room.status) {
      if (room.status === "hiding") {
        sfx.start();
        // "Hom pim pa" intro: shuffle player names, reveal seeker, 3-2-1.
        // All clients see this overlay; hiding UI is gated until intro ends.
        const names = players.map(p => p.name).filter(Boolean);
        const seekerName = players.find(p => p.player_id === room.seeker_id)?.name ?? "?";
        const timers: ReturnType<typeof setTimeout>[] = [];
        const intervals: ReturnType<typeof setInterval>[] = [];
        if (names.length > 0) {
          let i = 0;
          setIntro({ phase: "shuffle", shuffleName: names[0] });
          const shuf = setInterval(() => {
            i++;
            setIntro({ phase: "shuffle", shuffleName: names[i % names.length] });
            sfx.tap();
            vibrate(25); // synced tick with shuffle sound
          }, SHUFFLE_TICK_MS);
          intervals.push(shuf);

          // Reveal seeker name + alarm
          timers.push(setTimeout(() => {
            clearInterval(shuf);
            sfx.match();
            vibrate([120, 60, 120]);
            setIntro({ phase: "reveal", seekerName, countdown: COUNTDOWN_FROM });
          }, SHUFFLE_MS));

          // Start 3-2-1 countdown after REVEAL_HOLD_MS
          timers.push(setTimeout(() => {
            // first beep immediately at first countdown tick
            sfx.countdown();
            vibrate(60);
            let n = COUNTDOWN_FROM;
            const cd = setInterval(() => {
              n -= 1;
              if (n <= 0) {
                clearInterval(cd);
                // transition to hiding phase
                sfx.start();
                vibrate([40, 30, 40, 30, 80]);
                setIntro(null);
              } else {
                sfx.countdown();
                vibrate(60);
                setIntro(prev => prev && prev.phase === "reveal"
                  ? { ...prev, countdown: n } : prev);
              }
            }, COUNTDOWN_STEP_MS);
            intervals.push(cd);
          }, SHUFFLE_MS + REVEAL_HOLD_MS));
        }
        return () => {
          timers.forEach(clearTimeout);
          intervals.forEach(clearInterval);
        };
      }
      else if (room.status === "searching") sfx.hide();
      else if (room.status === "ended") sfx.win();
    }
    prevStatusRef.current = room?.status ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status]);

  // Server resolves duels on each tap; this poll covers the timeout case.
  useEffect(() => {
    if (!duel || duel.winner_id) return;
    const startMs = new Date(duel.started_at).getTime();
    const deadline = startMs + 8500;
    if (Date.now() >= deadline) {
      resolve$({ data: { duel_id: duel.id } }).catch(() => {});
      return;
    }
    const tm = setTimeout(() => {
      resolve$({ data: { duel_id: duel.id } }).catch(() => {});
    }, Math.max(0, deadline - Date.now()));
    return () => clearTimeout(tm);
  }, [duel, resolve$]);

  // Auto-close duel modal after resolution
  useEffect(() => {
    if (duel?.winner_id) {
      const won = duel.winner_id === pid;
      const isInDuel = duel.seeker_id === pid || duel.hider_id === pid;
      if (isInDuel) {
        if (duel.hider_id === pid) {
          toast(won ? t("msg_safe") : t("msg_caught"), { className: won ? "" : "bg-destructive" });
          if (won) sfx.safe(); else sfx.caught();
          vibrate(won ? 80 : [200, 80, 200]);
        }
        if (duel.seeker_id === pid) {
          toast(won ? t("msg_caught") + "!" : t("msg_safe"));
          if (won) sfx.success(); else sfx.empty();
        }
      }
      const tm = setTimeout(() => setDuel(null), 1500);
      return () => clearTimeout(tm);
    }
  }, [duel, pid, t]);

  async function startGameFn() {
    if (players.length < 3) { toast.error(t("msg_min_players")); return; }
    sfx.click();
    const res = await start$({ data: { room_id: id, player_id: pid } });
    if (!res.ok) { sfx.error(); toast.error(res.error ?? "Gagal mulai"); }
  }

  async function pickHidingSpotFn(spotId: string) {
    if (!me || me.role !== "hider" || me.status !== "waiting") return;
    const res = await pickHide$({ data: { room_id: id, player_id: pid, spot_id: spotId } });
    if (!res.ok) {
      sfx.error();
      toast(res.error === "taken" ? "Wes isi!" : "Gagal");
      return;
    }
    setMyHiddenSpot(spotId);
    sfx.hide();
    vibrate(40);
  }

  async function seekerPickSpotFn(spotId: string) {
    if (!isSeeker || effectiveStatus !== "searching") return;
    sfx.tap();
    const res = await seekerPick$({ data: { room_id: id, player_id: pid, spot_id: spotId } });
    if (!res.ok) { sfx.error(); toast.error("Ora iso"); return; }
    if (res.kind === "empty") {
      const isTrap = traps.has(spotId);
      vibrate(80);
      if (isTrap) sfx.trap(); else sfx.empty();
      toast.error(isTrap ? t("msg_trap") : t("msg_empty"));
    }
    // 'duel' branch: realtime INSERT on duels will trigger startDuel
  }

  async function tapTekong() {
    if (!duel || tappedRef.current) return;
    const startMs = new Date(duel.started_at).getTime();
    const reaction = Date.now() - startMs;
    if (reaction < 120) {
      vibrate(20);
      sfx.error();
      toast.error("Kecepetan! Coba maneh.");
      return;
    }
    tappedRef.current = true;
    setTapped(true);
    sfx.tap();
    const res = await tap$({ data: { duel_id: duel.id, player_id: pid } });
    if (!res.ok && res.error === "too_fast") {
      tappedRef.current = false;
      setTapped(false);
      sfx.error();
      toast.error("Kecepetan!");
      return;
    }
    vibrate(60);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) sfx.click();
  }

  async function leave() {
    await leave$({ data: { room_id: id, player_id: pid } });
    nav({ to: "/lobby" });
  }

  function share() {
    const url = `${window.location.origin}/room/${id}`;
    if (navigator.share) navigator.share({ title: "Tekongan Room", text: `Mlebu room ${id}`, url });
    else { navigator.clipboard.writeText(url); toast.success("Link disalin!"); }
  }

  function copyCode() {
    navigator.clipboard.writeText(id);
    toast.success("Kode room disalin!");
  }

  function shareWA() {
    if (!room) return;
    const lines = [
      "--- " + t("results_title") + " ---",
      `Performer: ${room.host_name}`,
      `Venue: ${room.venue_name ?? "-"}`,
      "",
      ...players.map(p => {
        const s = p.role === "seeker" ? "Penjaga" :
          p.status === "safe" ? stMap["safe"] :
          p.status === "caught" ? stMap["caught"] :
          stMap["waiting"];
        return `- ${p.name}: ${s}`;
      }),
    ].join("\n");
    const url = `https://wa.me/?text=${encodeURIComponent(lines)}`;
    window.open(url, "_blank");
  }

  if (needsName) {
    return (
      <div className="min-h-dvh grid place-items-center px-6 bg-background">
        <div className="w-full max-w-xs rounded-xl border border-border bg-card/80 backdrop-blur p-5 space-y-4 glow-cyan">
          <h2 className="font-display text-sm text-primary text-glow text-center">MLEBU ROOM</h2>
          <p className="text-[11px] text-muted-foreground text-center">
            Room <span className="font-mono text-primary">{id}</span> — lebokno jenengmu disik
          </p>
          <input
            autoFocus
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitName()}
            placeholder={t("placeholder_name")}
            maxLength={20}
            className="w-full bg-input rounded-md px-3 py-2 outline-none focus:ring-2 ring-primary"
          />
          <button onClick={submitName}
            className="w-full bg-primary text-primary-foreground rounded-md py-2 font-semibold active:scale-95 glow-cyan">
            Mlebu
          </button>
        </div>
        <Footer text={t("footer")} />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-dvh grid place-items-center text-primary">
        <div className="text-center space-y-3">
          <Loader2 className="mx-auto animate-spin" size={28} />
          <div className="font-display text-[10px] tracking-widest text-glow">MEMUAT ROOM...</div>
        </div>
      </div>
    );
  }

  const phaseLabel: Record<Room["status"], string> = {
    lobby: "LOBBY", hiding: "SINGITAN", searching: "NGGOLEKI", ended: "ENDED",
  };

  return (
    <div className={`relative min-h-dvh px-4 pt-4 pb-24 max-w-md mx-auto ${flash ? "animate-flash" : ""} ${dangerMode ? "animate-danger" : ""}`}>
      {reconnecting && (
        <div className="fixed top-2 right-2 z-50 flex items-center gap-1.5 rounded-full border border-primary/60 bg-card/90 backdrop-blur px-2.5 py-1 text-[10px] font-display tracking-widest text-primary glow-cyan animate-pulse" role="status" aria-live="polite">
          <Wifi size={11} className="animate-pulse" />
          <span>SINKRON...</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-display text-[10px] text-primary tracking-widest">{phaseLabel[effectiveStatus]}</div>
          <div className="text-lg font-mono tracking-widest">{room.id}</div>
          <div className="text-[10px] text-muted-foreground">{room.venue_name}</div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}
            className="p-2 rounded-md border border-border active:scale-95">
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <button onClick={share} className="p-2 rounded-md border border-border active:scale-95" aria-label="Bagikan link"><Share2 size={14} /></button>
          <button onClick={copyCode} className="p-2 rounded-md border border-border active:scale-95" aria-label="Salin kode room"><Copy size={14} /></button>
          <button onClick={leave} className="p-2 rounded-md border border-destructive text-destructive active:scale-95" aria-label="Tinggalkan room"><LogOut size={14} /></button>
        </div>
      </div>

      {(room.status === "searching" || room.status === "hiding") && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Shield size={14} className="text-primary" />
          <span className="text-xs text-muted-foreground">{t("label_lives")}:</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Heart key={i} size={14} className={i < room.seeker_lives ? "text-danger fill-danger" : "text-muted opacity-30"} />
          ))}
          {dangerMode && <span className="ml-auto text-xs font-display text-danger animate-pulse">{t("msg_danger")}</span>}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-border bg-card/50 p-3">
        <div className="text-[10px] font-display text-primary mb-2">{t("label_players")} ({players.length})</div>
        <div className="grid grid-cols-2 gap-2">
          {players.map(p => (
            <div key={p.id} className={`relative flex items-center gap-2 p-2 rounded ${p.player_id === pid ? "bg-primary/10 ring-1 ring-primary" : "bg-accent/30"}`}>
              {p.role === "seeker" && <Crown size={12} className="text-danger" />}
              {p.status === "safe" && <Shield size={12} className="text-success" />}
              {p.status === "caught" && <Skull size={12} className="text-destructive" />}
              {p.status === "hidden" && <EyeOff size={12} className="text-muted-foreground" />}
              <span className="text-xs truncate">{p.name}</span>
              {p.player_id === room.host_id && <span className="ml-auto text-[9px] text-primary">HOST</span>}
              {emotePops[p.player_id] && (
                <span
                  key={emotePops[p.player_id].key}
                  className="absolute -top-2 left-1/2 -translate-x-1/2 text-2xl animate-emote pointer-events-none drop-shadow-lg z-10"
                >
                  {emotePops[p.player_id].emote}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {effectiveStatus === "lobby" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground text-center">
              Min. 3 pemain. Host bakal milih Penjaga acak.
            </p>
            {isHost ? (
              <button onClick={startGameFn} disabled={players.length < 3}
                className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md py-3 font-semibold active:scale-95 disabled:opacity-40 glow-cyan">
                <Play size={16} /> {t("btn_start")}
              </button>
            ) : (
              <p className="text-center text-sm text-muted-foreground">Ngenteni host mulai...</p>
            )}
          </div>
        )}

        {effectiveStatus === "hiding" && (
          <HidingPhase
            isSeeker={isSeeker} remain={hidingRemain} me={me} myHiddenSpot={myHiddenSpot}
            spots={venueSpots} onPick={pickHidingSpotFn} />
        )}

        {effectiveStatus === "searching" && (
          <SearchingPhase
            isSeeker={isSeeker} me={me} spots={venueSpots} onPick={seekerPickSpotFn} />
        )}

        {effectiveStatus === "ended" && (
          <Results
            room={room} players={players} stMap={stMap}
            isHost={isHost}
            onShare={shareWA}
            onBack={() => nav({ to: "/lobby" })}
            onPlayAgain={async () => {
              sfx.click();
              const res = await playAgain$({ data: { room_id: id, player_id: pid } });
              if (!res.ok) { sfx.error(); toast.error("Gagal mulai maneh"); }
            }}
          />
        )}
      </div>

      <div className="mt-4">
        <ChatPanel roomId={id} name={myName} />
      </div>

      {intro && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm grid place-items-center px-6 animate-fade-in">
          {intro.phase === "shuffle" ? (
            <div className="text-center space-y-5 w-full max-w-xs">
              <div className="font-display text-[11px] tracking-[0.3em] text-primary text-glow">
                NGUNDI PENJAGA
              </div>
              <div className="font-display text-base text-primary text-glow leading-relaxed">
                HOM PIM PA<br />ALAIHUM GAMBRENG
              </div>
              <div className="h-14 grid place-items-center rounded-lg border border-primary/40 bg-card/60 glow-cyan">
                <span className="font-display text-sm text-foreground truncate px-2">
                  {intro.shuffleName}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary animate-pulse" style={{ width: "100%" }} />
              </div>
            </div>
          ) : (
            <div className="text-center space-y-4 w-full max-w-xs animate-scale-in">
              <div className="font-display text-[11px] tracking-[0.3em] text-danger">
                SENG DADI AREK IKI
              </div>
              <div className="rounded-xl border-2 border-danger bg-card/80 p-5 glow-red">
                <Crown size={28} className="mx-auto text-danger mb-2" />
                <div className="font-display text-lg text-danger text-glow break-words">
                  {intro.seekerName}
                </div>
              </div>
              <div className="font-display text-6xl text-primary text-glow animate-pulse">
                {intro.countdown}
              </div>
              <div className="text-[10px] text-muted-foreground font-display tracking-widest">
                SIAP SINGITAN...
              </div>
            </div>
          )}
        </div>
      )}

      {duel && !duel.winner_id && (duel.seeker_id === pid || duel.hider_id === pid) && (
        <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm">
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center space-y-2">
              <div className="font-display text-danger text-glow text-sm animate-pulse">{t("msg_match")}</div>
              <div className="text-xs text-muted-foreground">Cepetan tap!</div>
            </div>
          </div>
          <button
            onClick={tapTekong}
            disabled={tapped}
            style={{ left: `${tekongPos.x}%`, top: `${tekongPos.y}%` }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 px-6 py-4 rounded-full font-display text-base active:scale-90 transition ${
              tapped
                ? "bg-muted text-muted-foreground opacity-60 cursor-not-allowed"
                : "bg-danger text-white glow-red animate-danger"
            }`}
          >
            {tapped ? "..." : t("btn_tekong")}
          </button>
        </div>
      )}

      <Footer text={t("footer")} />
    </div>
  );
}

function HidingPhase({ isSeeker, remain, me, myHiddenSpot, spots, onPick }: {
  isSeeker: boolean; remain: number; me: Player | undefined; myHiddenSpot: string | null;
  spots: { id: string; text: string }[];
  onPick: (id: string) => void;
}) {
  const { t } = useContent();
  if (isSeeker) {
    if (remain <= 0) {
      return (
        <div className="rounded-xl border border-primary/40 bg-black/60 p-8 text-center glow-cyan">
          <Loader2 size={40} className="mx-auto text-primary animate-spin" />
          <p className="mt-4 font-display text-sm text-primary text-glow">SIAP NGGOLEKI...</p>
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-border bg-black/60 p-8 text-center">
        <EyeOff size={48} className="mx-auto text-primary opacity-50" />
        <p className="mt-4 font-display text-sm text-primary text-glow">{t("msg_merem")}</p>
        <p className="mt-6 text-5xl font-display text-danger">{remain}</p>
      </div>
    );
  }
  const alreadyHidden = me?.status === "hidden";
  return (
    <div>
      <p className="text-center text-xs text-muted-foreground mb-2">
        {t("msg_hiding")} <span className="text-danger font-mono">{remain}s</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        {spots.map(s => {
          const isMine = myHiddenSpot === s.id;
          return (
            <button key={s.id} disabled={alreadyHidden} onClick={() => onPick(s.id)}
              className={`relative p-3 rounded-lg border text-sm text-left transition active:scale-95
                ${isMine ? "border-primary bg-primary/20 glow-cyan" :
                  alreadyHidden ? "border-border bg-muted/30 opacity-50" :
                  "border-border bg-card hover:border-primary"}`}>
              <span>{s.text}</span>
              {isMine && <span className="block text-[10px] text-primary mt-1">★ Kowe singitan kene</span>}
            </button>
          );
        })}
      </div>
      {!alreadyHidden && (
        <p className="mt-2 text-center text-[10px] text-muted-foreground italic">
          Panggonan liyane mungkin wis diisi — coba pilih dhisik.
        </p>
      )}
    </div>
  );
}

function SearchingPhase({ isSeeker, me, spots, onPick }: {
  isSeeker: boolean; me: Player | undefined;
  spots: { id: string; text: string }[];
  onPick: (id: string) => void;
}) {
  const { t } = useContent();
  if (!isSeeker) {
    const myStatus = me?.status;
    return (
      <div className="rounded-xl border border-border bg-card/50 p-6 text-center space-y-3">
        <EyeOff size={36} className="mx-auto text-primary" />
        <p className="font-display text-xs text-primary">{t("msg_searching")}</p>
        {myStatus === "hidden" && <p className="text-xs text-muted-foreground">Tetep meneng. Ojo obah!</p>}
        {myStatus === "safe" && <p className="text-success font-display text-sm">★ {t("msg_safe")}</p>}
        {myStatus === "caught" && <p className="text-destructive font-display text-sm">✗ {t("msg_caught")}</p>}
      </div>
    );
  }
  return (
    <div>
      <p className="text-center text-xs text-muted-foreground mb-2 flex items-center justify-center gap-1">
        <Eye size={12} /> Pilih panggonan kanggo dicek
      </p>
      <div className="grid grid-cols-2 gap-2">
        {spots.map(s => (
          <button key={s.id} onClick={() => onPick(s.id)}
            className="p-3 rounded-lg border border-border bg-card hover:border-danger active:scale-95 text-sm text-left transition">
            {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Results({ room, players, stMap, isHost, onShare, onBack, onPlayAgain }: {
  room: Room; players: Player[]; stMap: Record<string, string>;
  isHost: boolean;
  onShare: () => void; onBack: () => void; onPlayAgain: () => void;
}) {
  const { t } = useContent();
  const canReplay = players.length >= 3;
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5 space-y-4">
      <h2 className="font-display text-sm text-primary text-center text-glow">{t("results_title")}</h2>
      <div className="text-center text-xs text-muted-foreground">
        <div>Performer: <span className="text-foreground">{room.host_name}</span></div>
        <div>Venue: <span className="text-foreground">{room.venue_name}</span></div>
      </div>
      <div className="space-y-1">
        {players.map(p => {
          const s = p.role === "seeker" ? "Penjaga" :
            p.status === "safe" ? stMap["safe"] :
            p.status === "caught" ? stMap["caught"] : stMap["waiting"];
          return (
            <div key={p.id} className="flex justify-between text-sm border-b border-border/50 py-1">
              <span>- {p.name}</span>
              <span className={p.status === "safe" ? "text-success" : p.status === "caught" ? "text-destructive" : "text-muted-foreground"}>
                {s}
              </span>
            </div>
          );
        })}
      </div>
      {isHost && (
        <button
          onClick={onPlayAgain}
          disabled={!canReplay}
          className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md py-3 font-semibold active:scale-95 disabled:opacity-40 glow-cyan"
        >
          <RotateCcw size={16} /> Main Maneh
        </button>
      )}
      {!isHost && (
        <p className="text-center text-[11px] text-muted-foreground">
          Ngenteni host milih main maneh utowo mlebu lobby...
        </p>
      )}
      <div className="flex gap-2">
        <button onClick={onShare} className="flex-1 bg-primary text-primary-foreground rounded-md py-2 font-semibold active:scale-95 glow-cyan">
          📱 WhatsApp
        </button>
        <button onClick={onBack} className="flex-1 border border-border rounded-md py-2 active:scale-95">
          Lobby
        </button>
      </div>
    </div>
  );
}
