-- Custom SQL migration file, put your code below! --
-- Neon Authorize / Neon RLS: JWT ベースの `authenticated` ロールへテーブル権限を付与する。
-- 行の可否は 0001_init.sql のポリシーが制御する。これらの GRANT が無いと全クエリが拒否される。
-- `authenticated` ロール自体は Neon が管理するため、ここでは権限付与のみ行う。

GRANT USAGE ON SCHEMA public TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "vehicles" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "vehicle_members" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "trips" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user_states" TO authenticated;