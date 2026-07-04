// Server-enforced chat limits. Tunable via env vars (no DB migration needed):
//   CHAT_RATE_LIMIT_MS  — minimum gap between messages per player (default 500)
//   CHAT_MAX_LENGTH     — max characters per message (default 100)
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  room_id: z.string().min(1).max(64),
  player_id: z.string().min(1).max(64),
  name: z.string().min(1).max(40),
  content: z.string().min(1).max(2000),
});

export const sendChatMessage = createServerFn({ method: "POST" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const RATE_MS = Number(process.env.CHAT_RATE_LIMIT_MS ?? 500);
    const MAX_LEN = Number(process.env.CHAT_MAX_LENGTH ?? 100);

    const raw = data.content ?? "";
    const truncated = raw.length > MAX_LEN;
    const content = raw.slice(0, MAX_LEN).trim();
    if (!content) return { ok: false as const, code: "empty" as const };

    // Per-player rate limit: look up last message in this room.
    const { data: last } = await supabaseAdmin
      .from("chat_messages")
      .select("created_at")
      .eq("room_id", data.room_id)
      .eq("player_id", data.player_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.created_at) {
      const gap = Date.now() - new Date(last.created_at).getTime();
      if (gap < RATE_MS) return { ok: false as const, code: "rate_limited" as const };
    }

    const { error } = await supabaseAdmin.from("chat_messages").insert({
      room_id: data.room_id,
      player_id: data.player_id,
      name: data.name.slice(0, 20),
      content,
    });
    if (error) return { ok: false as const, code: "error" as const, message: error.message };

    return { ok: true as const, truncated };
  });
