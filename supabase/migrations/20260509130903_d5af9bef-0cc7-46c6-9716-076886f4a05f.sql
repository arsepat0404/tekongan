
-- Rooms
CREATE TABLE public.rooms (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  host_name TEXT NOT NULL,
  venue_id TEXT,
  venue_name TEXT,
  status TEXT NOT NULL DEFAULT 'lobby', -- lobby | hiding | searching | ended
  seeker_id TEXT,
  seeker_lives INT NOT NULL DEFAULT 3,
  hiding_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.room_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'hider', -- seeker | hider
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | hidden | safe | caught
  hidden_spot_id TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(room_id, player_id)
);

CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.emotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  emote TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.duels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  spot_id TEXT NOT NULL,
  seeker_id TEXT NOT NULL,
  hider_id TEXT NOT NULL,
  seeker_tapped_at TIMESTAMPTZ,
  hider_tapped_at TIMESTAMPTZ,
  winner_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS — gated app, allow anonymous public access
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public all rooms" ON public.rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all players" ON public.room_players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all chat" ON public.chat_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all emotes" ON public.emotes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all duels" ON public.duels FOR ALL USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.emotes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.duels;

ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_players REPLICA IDENTITY FULL;
ALTER TABLE public.duels REPLICA IDENTITY FULL;
