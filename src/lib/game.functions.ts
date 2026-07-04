// All mutating operations on game tables go through these server functions.
// RLS denies INSERT/UPDATE/DELETE for anon/authenticated; only supabaseAdmin
// (service role) can write. Each fn validates input + game-logic rules so a
// player_id from the client can't impersonate beyond what game state allows.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RoomIdSchema = z.string().min(3).max(16).regex(/^[A-Z0-9]+$/);
const PlayerIdSchema = z.string().min(2).max(64).regex(/^[A-Za-z0-9_-]+$/);
const NameSchema = z.string().trim().min(1).max(20);
const SpotIdSchema = z.string().min(1).max(64);

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ----------- Room lifecycle -----------

export const createRoom = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      room_id: RoomIdSchema,
      player_id: PlayerIdSchema,
      name: NameSchema,
      venue_id: z.string().min(1).max(64).nullable().optional(),
      venue_name: z.string().min(1).max(120).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error: rErr } = await sb.from("rooms").insert({
      id: data.room_id, host_id: data.player_id, host_name: data.name,
      venue_id: data.venue_id ?? null, venue_name: data.venue_name ?? null,
      status: "lobby",
    });
    if (rErr) return { ok: false as const, error: rErr.message };
    const { error: pErr } = await sb.from("room_players").insert({
      room_id: data.room_id, player_id: data.player_id, name: data.name,
      role: "hider", status: "waiting",
    });
    if (pErr) return { ok: false as const, error: pErr.message };
    return { ok: true as const };
  });

export const joinRoom = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      room_id: RoomIdSchema,
      player_id: PlayerIdSchema,
      name: NameSchema,
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: room } = await sb.from("rooms").select("id,status").eq("id", data.room_id).maybeSingle();
    if (!room) return { ok: false as const, error: "not_found" };
    if (room.status !== "lobby") {
      // allow rejoin if player already in room
      const { data: existing } = await sb.from("room_players")
        .select("id").eq("room_id", data.room_id).eq("player_id", data.player_id).maybeSingle();
      if (!existing) return { ok: false as const, error: "in_progress" };
    }
    const { error } = await sb.from("room_players").upsert({
      room_id: data.room_id, player_id: data.player_id, name: data.name,
      role: "hider", status: "waiting",
    }, { onConflict: "room_id,player_id" });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const leaveRoom = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ room_id: RoomIdSchema, player_id: PlayerIdSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    await sb.from("room_players").delete().eq("room_id", data.room_id).eq("player_id", data.player_id);
    await sb.from("room_hidden_spots").delete().eq("room_id", data.room_id).eq("player_id", data.player_id);
    return { ok: true as const };
  });

// ----------- Game flow -----------

// Total intro overlay duration in ms (shuffle + reveal + 3-2-1 countdown).
// Must match INTRO_TOTAL_MS in src/routes/room.$id.tsx so the hiding timer
// isn't burned by the intro animation. Tune both together.
export const INTRO_TOTAL_MS = 8500;
export const HIDING_MS = 25_000;

export const startGame = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ room_id: RoomIdSchema, player_id: PlayerIdSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: room } = await sb.from("rooms").select("host_id,status").eq("id", data.room_id).maybeSingle();
    if (!room) return { ok: false as const, error: "not_found" };
    if (room.host_id !== data.player_id) return { ok: false as const, error: "forbidden" };
    if (room.status !== "lobby") return { ok: false as const, error: "bad_state" };

    const { data: players } = await sb.from("room_players").select("player_id").eq("room_id", data.room_id);
    if (!players || players.length < 3) return { ok: false as const, error: "min_players" };

    const seeker = players[Math.floor(Math.random() * players.length)];
    await sb.from("room_hidden_spots").delete().eq("room_id", data.room_id);
    await sb.from("room_players").update({ role: "hider", status: "waiting" }).eq("room_id", data.room_id);
    await sb.from("room_players").update({ role: "seeker" })
      .eq("room_id", data.room_id).eq("player_id", seeker.player_id);

    // Extend by intro overlay so the hiding window isn't consumed by the 3-2-1.
    const endsAt = new Date(Date.now() + INTRO_TOTAL_MS + HIDING_MS).toISOString();
    await sb.from("rooms").update({
      status: "hiding", seeker_id: seeker.player_id, seeker_lives: 3, hiding_ends_at: endsAt,
    }).eq("id", data.room_id);
    return { ok: true as const };
  });

// Host can reset a finished/in-progress room back to lobby keeping all players.
export const playAgain = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ room_id: RoomIdSchema, player_id: PlayerIdSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: room } = await sb.from("rooms").select("host_id").eq("id", data.room_id).maybeSingle();
    if (!room) return { ok: false as const, error: "not_found" };
    if (room.host_id !== data.player_id) return { ok: false as const, error: "forbidden" };

    await sb.from("room_hidden_spots").delete().eq("room_id", data.room_id);
    await sb.from("duels").delete().eq("room_id", data.room_id);
    await sb.from("room_players").update({ role: "hider", status: "waiting" }).eq("room_id", data.room_id);
    await sb.from("rooms").update({
      status: "lobby", seeker_id: null, seeker_lives: 3, hiding_ends_at: null,
    }).eq("id", data.room_id);
    return { ok: true as const };
  });

export const advanceToSearching = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ room_id: RoomIdSchema }).parse(input))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: room } = await sb.from("rooms").select("status,hiding_ends_at").eq("id", data.room_id).maybeSingle();
    if (!room || room.status !== "hiding") return { ok: true as const };
    if (!room.hiding_ends_at || new Date(room.hiding_ends_at).getTime() > Date.now()) {
      return { ok: false as const, error: "too_early" };
    }
    await sb.from("rooms").update({ status: "searching" }).eq("id", data.room_id).eq("status", "hiding");
    return { ok: true as const };
  });

export const endRoom = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ room_id: RoomIdSchema }).parse(input))
  .handler(async ({ data }) => {
    const sb = await admin();
    await sb.from("rooms").update({ status: "ended" }).eq("id", data.room_id);
    return { ok: true as const };
  });

// ----------- Hiding -----------

export const pickHidingSpot = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      room_id: RoomIdSchema,
      player_id: PlayerIdSchema,
      spot_id: SpotIdSchema,
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: room } = await sb.from("rooms").select("status").eq("id", data.room_id).maybeSingle();
    if (!room || room.status !== "hiding") return { ok: false as const, error: "bad_state" };

    const { data: me } = await sb.from("room_players").select("role,status")
      .eq("room_id", data.room_id).eq("player_id", data.player_id).maybeSingle();
    if (!me || me.role !== "hider" || me.status !== "waiting") return { ok: false as const, error: "forbidden" };

    const { error: spotErr } = await sb.from("room_hidden_spots").insert({
      room_id: data.room_id, player_id: data.player_id, spot_id: data.spot_id,
    });
    if (spotErr) {
      // unique violation → spot taken or player already picked
      return { ok: false as const, error: "taken" };
    }
    await sb.from("room_players").update({ status: "hidden" })
      .eq("room_id", data.room_id).eq("player_id", data.player_id);
    return { ok: true as const };
  });

// ----------- Seeking -----------

export const seekerPick = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      room_id: RoomIdSchema,
      player_id: PlayerIdSchema,
      spot_id: SpotIdSchema,
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: room } = await sb.from("rooms").select("status,seeker_id,seeker_lives")
      .eq("id", data.room_id).maybeSingle();
    if (!room || room.status !== "searching") return { ok: false as const, error: "bad_state" };
    if (room.seeker_id !== data.player_id) return { ok: false as const, error: "forbidden" };

    const { data: occupant } = await sb.from("room_hidden_spots")
      .select("player_id").eq("room_id", data.room_id).eq("spot_id", data.spot_id).maybeSingle();

    if (occupant) {
      // Ensure occupant is still 'hidden' (not already caught/safe).
      const { data: hp } = await sb.from("room_players").select("status")
        .eq("room_id", data.room_id).eq("player_id", occupant.player_id).maybeSingle();
      if (hp?.status === "hidden") {
        const { data: duel, error } = await sb.from("duels").insert({
          room_id: data.room_id, spot_id: data.spot_id,
          seeker_id: data.player_id, hider_id: occupant.player_id,
        }).select("id").single();
        if (error) return { ok: false as const, error: error.message };
        return { ok: true as const, kind: "duel" as const, duel_id: duel.id };
      }
    }
    await sb.from("rooms").update({ seeker_lives: Math.max(0, room.seeker_lives - 1) }).eq("id", data.room_id);
    return { ok: true as const, kind: "empty" as const };
  });

// ----------- Duels -----------

const DUEL_TIMEOUT_MS = 8000;

async function maybeResolveDuel(sb: Awaited<ReturnType<typeof admin>>, duelId: string) {
  const { data: d } = await sb.from("duels").select("*").eq("id", duelId).maybeSingle();
  if (!d || d.winner_id) return;
  const startMs = new Date(d.started_at).getTime();
  const sT = d.seeker_tapped_at ? new Date(d.seeker_tapped_at).getTime() : null;
  const hT = d.hider_tapped_at ? new Date(d.hider_tapped_at).getTime() : null;

  let winner: string | null = null;
  if (sT && hT) winner = sT <= hT ? d.seeker_id : d.hider_id;
  else if (Date.now() - startMs >= DUEL_TIMEOUT_MS) {
    if (sT && !hT) winner = d.seeker_id;
    else if (hT && !sT) winner = d.hider_id;
    else winner = d.hider_id;
  }
  if (!winner) return;
  const hiderStatus = winner === d.hider_id ? "safe" : "caught";
  await sb.from("duels").update({ winner_id: winner }).eq("id", d.id).is("winner_id", null);
  await sb.from("room_players").update({ status: hiderStatus })
    .eq("room_id", d.room_id).eq("player_id", d.hider_id);
}

export const tapDuel = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      duel_id: z.string().uuid(),
      player_id: PlayerIdSchema,
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: d } = await sb.from("duels").select("*").eq("id", data.duel_id).maybeSingle();
    if (!d) return { ok: false as const, error: "not_found" };
    if (d.winner_id) return { ok: true as const, already: true };

    const startMs = new Date(d.started_at).getTime();
    const reaction = Date.now() - startMs;
    if (reaction < 120) return { ok: false as const, error: "too_fast" };

    const ts = new Date().toISOString();
    if (d.seeker_id === data.player_id) {
      if (d.seeker_tapped_at) return { ok: true as const, already: true };
      await sb.from("duels").update({ seeker_tapped_at: ts }).eq("id", d.id).is("seeker_tapped_at", null);
    } else if (d.hider_id === data.player_id) {
      if (d.hider_tapped_at) return { ok: true as const, already: true };
      await sb.from("duels").update({ hider_tapped_at: ts }).eq("id", d.id).is("hider_tapped_at", null);
    } else {
      return { ok: false as const, error: "forbidden" };
    }
    await maybeResolveDuel(sb, d.id);
    return { ok: true as const };
  });

export const resolveDuel = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ duel_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = await admin();
    await maybeResolveDuel(sb, data.duel_id);
    return { ok: true as const };
  });

// ----------- Emotes -----------

const EMOTE_MIN_INTERVAL_MS = 500;
const ALLOWED_EMOTES = new Set(["👻", "😂", "🤫", "💥"]);

export const sendEmote = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      room_id: RoomIdSchema,
      player_id: PlayerIdSchema,
      emote: z.string().min(1).max(8),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!ALLOWED_EMOTES.has(data.emote)) return { ok: false as const, error: "bad_emote" };
    const sb = await admin();
    const { data: last } = await sb.from("emotes").select("created_at")
      .eq("room_id", data.room_id).eq("player_id", data.player_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.created_at && Date.now() - new Date(last.created_at).getTime() < EMOTE_MIN_INTERVAL_MS) {
      return { ok: false as const, error: "rate_limited" };
    }
    const { error } = await sb.from("emotes").insert({
      room_id: data.room_id, player_id: data.player_id, emote: data.emote,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
