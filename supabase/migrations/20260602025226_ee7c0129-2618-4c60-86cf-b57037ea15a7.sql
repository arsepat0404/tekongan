DROP TRIGGER IF EXISTS chat_messages_enforce_limits ON public.chat_messages;
DROP FUNCTION IF EXISTS public.enforce_chat_limits();