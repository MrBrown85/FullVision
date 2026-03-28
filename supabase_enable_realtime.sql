-- Enable Supabase Realtime on course_data table
-- This allows cross-device sync (phone → laptop) via WebSocket subscriptions
-- RLS policies still apply — teachers only receive changes for their own data

ALTER PUBLICATION supabase_realtime ADD TABLE course_data;

-- Ensure REPLICA IDENTITY is set so UPDATE/DELETE payloads include the full row
ALTER TABLE course_data REPLICA IDENTITY FULL;
