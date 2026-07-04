import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useContent } from "./ContentProvider";
import { getPlayerId } from "@/lib/player";
import { sendChatMessage } from "@/lib/chat.functions";
import { sendEmote } from "@/lib/game.functions";
import { Send } from "lucide-react";

type Msg = {
  id: string; player_id: string; name: string; content: string; created_at: string;
  // Optional client-only flag for locally-injected system notices.
  _system?: boolean;
};

const EMOTES = ["👻", "😂", "🤫", "💥"];
// Client-side limits mirror server env defaults but are only UX hints; the
// server (src/lib/chat.functions.ts) is the source of truth.
const MAX_LEN = Number(import.meta.env.VITE_CHAT_MAX_LENGTH ?? 100);
const MIN_INTERVAL_MS = Number(import.meta.env.VITE_CHAT_RATE_LIMIT_MS ?? 500);

const SYSTEM_NAME = "Sistem";
const SYSTEM_MSG_RATE = "Ojok kesusu ngetik! selak nang ndi?";
const SYSTEM_MSG_TRUNC = "tulisanmu kedawan!";

export function ChatPanel({ roomId, name, onEmote }: { roomId: string; name: string; onEmote?: (emote: string) => void }) {
  const { t } = useContent();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const pid = getPlayerId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSendRef = useRef(0);
  const send$ = useServerFn(sendChatMessage);
  const emote$ = useServerFn(sendEmote);

  function pushSystem(content: string) {
    setMsgs(prev => [...prev, {
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      player_id: "system", name: SYSTEM_NAME, content,
      created_at: new Date().toISOString(), _system: true,
    }]);
  }

  useEffect(() => {
    let alive = true;
    supabase.from("chat_messages").select("*").eq("room_id", roomId).order("created_at", { ascending: true }).limit(100)
      .then(({ data }) => { if (alive && data) setMsgs(data as Msg[]); });
    const ch = supabase.channel(`chat-${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
        (payload) => setMsgs(p => [...p, payload.new as Msg]))
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [roomId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs]);

  async function send() {
    const now = Date.now();
    if (now - lastSendRef.current < MIN_INTERVAL_MS) {
      pushSystem(SYSTEM_MSG_RATE);
      return;
    }
    const raw = text;
    const v = raw.trim();
    if (!v) return;
    if (raw.length > MAX_LEN) pushSystem(SYSTEM_MSG_TRUNC);
    lastSendRef.current = now;
    setText("");
    try {
      const res = await send$({ data: { room_id: roomId, player_id: pid, name, content: v } });
      if (!res?.ok) {
        if (res?.code === "rate_limited") pushSystem(SYSTEM_MSG_RATE);
        else if (res?.code === "empty") {/* noop */}
      } else if (res.truncated) {
        // Server confirmed truncation — surface system note if not already shown.
        if (raw.length <= MAX_LEN) pushSystem(SYSTEM_MSG_TRUNC);
      }
    } catch {
      pushSystem(SYSTEM_MSG_RATE);
    }
  }

  async function fireEmote(e: string) {
    const now = Date.now();
    if (now - lastSendRef.current < MIN_INTERVAL_MS) return;
    lastSendRef.current = now;
    onEmote?.(e);
    await emote$({ data: { room_id: roomId, player_id: pid, emote: e } }).catch(() => {});
  }

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card/60 backdrop-blur overflow-hidden">
      <div className="px-3 py-2 text-[10px] font-display tracking-widest text-primary border-b border-border">
        {t("label_chat")}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1 max-h-40 min-h-24 text-sm">
        {msgs.map(m => (
          <div key={m.id}>
            {m._system ? (
              <span className="text-[11px] italic text-destructive">
                <span className="font-display tracking-wider mr-1">[{m.name}]</span>
                {m.content}
              </span>
            ) : (
              <>
                <span className={`font-semibold ${m.player_id === pid ? "text-primary" : "text-foreground/90"}`}>
                  {m.name}:
                </span>{" "}
                <span className="text-foreground/80">{m.content}</span>
              </>
            )}
          </div>
        ))}
        {!msgs.length && <div className="text-muted-foreground text-xs italic">No chat yet...</div>}
      </div>
      <div className="flex gap-1 px-2 py-1 border-t border-border">
        {EMOTES.map(e => (
          <button key={e} onClick={() => fireEmote(e)}
            className="text-lg w-9 h-9 rounded hover:bg-accent/50 active:scale-95 transition">
            {e}
          </button>
        ))}
      </div>
      <div className="flex gap-1 p-2 border-t border-border">
        <input
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder={t("placeholder_chat")}
          className="flex-1 bg-input rounded px-2 py-1 text-sm outline-none focus:ring-2 ring-primary"
        />
        <button onClick={send} className="px-3 rounded bg-primary text-primary-foreground active:scale-95">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
