
-- 1) Drop overly permissive ALL policies
DROP POLICY IF EXISTS "public all rooms"   ON public.rooms;
DROP POLICY IF EXISTS "public all players" ON public.room_players;
DROP POLICY IF EXISTS "public all chat"    ON public.chat_messages;
DROP POLICY IF EXISTS "public all emotes"  ON public.emotes;
DROP POLICY IF EXISTS "public all duels"   ON public.duels;

-- 2) Revoke writes from anon/authenticated; keep SELECT
REVOKE INSERT, UPDATE, DELETE ON public.rooms         FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.room_players  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.chat_messages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.emotes        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.duels         FROM anon, authenticated;

GRANT SELECT ON public.rooms         TO anon, authenticated;
GRANT SELECT ON public.room_players  TO anon, authenticated;
GRANT SELECT ON public.chat_messages TO anon, authenticated;
GRANT SELECT ON public.emotes        TO anon, authenticated;
GRANT SELECT ON public.duels         TO anon, authenticated;

-- service_role keeps full access for server functions
GRANT ALL ON public.rooms         TO service_role;
GRANT ALL ON public.room_players  TO service_role;
GRANT ALL ON public.chat_messages TO service_role;
GRANT ALL ON public.emotes        TO service_role;
GRANT ALL ON public.duels         TO service_role;

-- 3) Public-read policies (everything is part of a casual shared game; reads are intentional)
CREATE POLICY "read rooms"   ON public.rooms         FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read players" ON public.room_players  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read chat"    ON public.chat_messages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read emotes"  ON public.emotes        FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read duels"   ON public.duels         FOR SELECT TO anon, authenticated USING (true);

-- 4) Move hidden_spot_id into a private table so it cannot leak via Postgres reads OR Realtime broadcasts.
CREATE TABLE public.room_hidden_spots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  player_id text NOT NULL,
  spot_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, player_id),
  UNIQUE (room_id, spot_id)
);
-- service_role only — anon/authenticated get NOTHING (no grant, no policy)
GRANT ALL ON public.room_hidden_spots TO service_role;
ALTER TABLE public.room_hidden_spots ENABLE ROW LEVEL SECURITY;
-- Intentionally NOT added to supabase_realtime publication.

-- 5) Drop the leaky column on room_players
ALTER TABLE public.room_players DROP COLUMN IF EXISTS hidden_spot_id;
