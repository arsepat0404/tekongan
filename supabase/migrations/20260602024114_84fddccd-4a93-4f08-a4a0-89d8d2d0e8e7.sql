CREATE OR REPLACE FUNCTION public.enforce_chat_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  last_ts timestamptz;
BEGIN
  NEW.content := left(coalesce(NEW.content, ''), 100);
  IF length(btrim(NEW.content)) = 0 THEN
    RAISE EXCEPTION 'empty_message';
  END IF;
  NEW.name := left(coalesce(NEW.name, 'Anon'), 20);

  SELECT max(created_at) INTO last_ts
    FROM public.chat_messages
   WHERE room_id = NEW.room_id AND player_id = NEW.player_id;

  IF last_ts IS NOT NULL AND (now() - last_ts) < interval '500 milliseconds' THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  RETURN NEW;
END;
$$;