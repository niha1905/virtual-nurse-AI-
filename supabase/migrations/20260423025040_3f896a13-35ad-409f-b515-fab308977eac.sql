-- Add countdown timestamp to alerts so all roles can see when auto-escalation will fire
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS auto_escalate_at timestamptz,
  ADD COLUMN IF NOT EXISTS alarm_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS alarm_cancelled_by uuid;

-- Make alerts table broadcast realtime changes to all subscribed roles
ALTER TABLE public.alerts REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'alerts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'alert_escalations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.alert_escalations';
  END IF;
END $$;