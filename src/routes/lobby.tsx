import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ContentProvider, useContent } from "@/components/ContentProvider";
import { Footer } from "@/components/Footer";
import { isAuthorized, getPlayerId, getPlayerName, setPlayerName, genRoomCode } from "@/lib/player";
import { supabase } from "@/integrations/supabase/client";
import { createRoom, joinRoom } from "@/lib/game.functions";
import { Plus, LogIn, Loader2, ExternalLink, Sparkles } from "lucide-react";
import arsepatHub from "@/assets/arsepat-hub.png.asset.json";

export const Route = createFileRoute("/lobby")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: (search.redirect as string) ?? "",
  }),
  head: () => ({ meta: [{ title: "Lobby — Tekongan" }] }),
  component: () => <ContentProvider><Lobby /></ContentProvider>,
});

function Lobby() {
  const { t, venues } = useContent();
  const nav = useNavigate();
  const { redirect } = useSearch({ from: "/lobby" });
  const [name, setName] = useState("");
  const [room, setRoom] = useState(redirect ?? "");
  const [venue, setVenue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const create$ = useServerFn(createRoom);
  const join$ = useServerFn(joinRoom);

  useEffect(() => {
    if (!isAuthorized()) {
      nav({ to: "/", search: { redirect: redirect ?? "" } }); return;
    }
    const savedName = getPlayerName();
    setName(savedName); // prefill nama terakhir, tapi pemain tetap bisa ubah
    setVenue(venues[0]?.id ?? "");
    // Tidak auto-join — pemain harus konfirmasi nama dulu sebelum masuk room
    // Room code sudah ter-prefill dari redirect, pemain tinggal klik tombol join
  }, [nav, venues, redirect]);

  // joinByRedirect dihapus — pemain selalu konfirmasi nama dulu sebelum join

  async function create() {
    if (!name.trim()) return setErr("Nama dulu!");
    setPlayerName(name.trim());
    setBusy(true); setErr("");
    const id = genRoomCode();
    const v = venues.find(x => x.id === venue);
    const pid = getPlayerId();
    const res = await create$({ data: {
      room_id: id, player_id: pid, name: name.trim(),
      venue_id: v?.id ?? null, venue_name: v?.name ?? null,
    }});
    if (!res.ok) { setErr(res.error ?? "Gagal"); setBusy(false); return; }
    nav({ to: "/room/$id", params: { id } });
  }

  async function join() {
    if (!name.trim() || !room.trim()) return setErr("Nama lan kode room!");
    setPlayerName(name.trim());
    setBusy(true); setErr("");
    const id = room.trim().toUpperCase();
    const { data: r } = await supabase.from("rooms").select("id").eq("id", id).maybeSingle();
    if (!r) { setErr("Room ora ketemu"); setBusy(false); return; }
    const pid = getPlayerId();
    const res = await join$({ data: { room_id: id, player_id: pid, name: name.trim() } });
    if (!res.ok) {
      setErr(res.error === "in_progress" ? "Permainan wis mulai" : (res.error ?? "Gagal"));
      setBusy(false); return;
    }
    nav({ to: "/room/$id", params: { id } });
  }

  return (
    <div className="min-h-dvh px-5 pt-8 pb-24 max-w-md mx-auto">
      <h1 className="text-xl text-glow text-primary text-center">{t("app_title")}</h1>
      <p className="text-center text-[10px] tracking-widest text-muted-foreground mt-1">{t("app_subtitle")}</p>

      <div className="mt-8 space-y-5">
        <div>
          <label className="text-xs text-muted-foreground">{t("placeholder_name")}</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full mt-1 bg-input rounded-md px-3 py-2 outline-none focus:ring-2 ring-primary"
            placeholder={t("placeholder_name")} maxLength={20} />
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
          <h2 className="font-display text-[11px] text-primary">CREATE</h2>
          <select value={venue} onChange={e => setVenue(e.target.value)}
            className="w-full bg-input rounded-md px-3 py-2 outline-none focus:ring-2 ring-primary">
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <button disabled={busy} onClick={create}
            className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md py-2 font-semibold active:scale-95 disabled:opacity-50 glow-cyan">
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} {t("btn_create")}
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
          <h2 className="font-display text-[11px] text-primary">JOIN</h2>
          <input value={room} onChange={e => setRoom(e.target.value.toUpperCase())}
            className="w-full bg-input rounded-md px-3 py-2 outline-none focus:ring-2 ring-primary tracking-widest text-center font-mono"
            placeholder={t("placeholder_room")} maxLength={5} />
          <button disabled={busy} onClick={join}
            className="w-full inline-flex items-center justify-center gap-2 border border-primary text-primary rounded-md py-2 font-semibold active:scale-95 disabled:opacity-50">
            {busy ? <Loader2 className="animate-spin" size={16} /> : <LogIn size={16} />} {t("btn_join")}
          </button>
        </div>

        {err && <p className="text-center text-sm text-destructive">{err}</p>}

        <a
          href="https://arsepat-game.web.id/"
          className="group block rounded-xl border border-border bg-card/50 p-4 hover:border-primary/60 hover:bg-card transition-colors"
        >
          <div className="text-center">
            <div className="text-sm text-foreground/90">Arsepat Game Hub</div>
            <div className="text-[9px] tracking-widest text-muted-foreground mt-0.5">Kreativitas Tanpa Batas</div>
          </div>
          <div className="mt-3 rounded-lg overflow-hidden border border-border">
            <img
              src={arsepatHub.url}
              alt="Preview game-game di Arsepat Game Hub"
              className="w-full h-auto object-cover"
              loading="lazy"
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Sparkles size={14} className="text-primary shrink-0" />
              <span className="font-display text-[10px] text-foreground truncate">Arsepat Game Hub</span>
            </div>
            <ExternalLink size={14} className="text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
          </div>
          <p className="mt-3 text-sm font-semibold text-foreground leading-snug">
            Dolanan seru liyane wis ngenteni. Mampir yo!
          </p>
          <p className="mt-1 text-xs text-muted-foreground leading-snug">
            Dari tebak-tebakan, kuis, hingga party game — semua bikin ketawa bareng teman.
          </p>
        </a>
      </div>

      <Footer text={t("footer")} />
    </div>
  );
}
