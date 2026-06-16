-- Custom SQL migration file, put your code below! --
-- 権限判定用の SECURITY DEFINER 関数。所有者権限で実行され RLS をバイパスするため、
-- vehicle_members を参照するポリシーが自己再帰せずに評価できる。
-- plpgsql のため、本体で参照する vehicle_members はこの時点で未作成でも問題ない
-- （0001_init.sql で作成され、関数の「呼び出し時」に存在していればよい）。
-- `auth.user_id()` は Neon RLS が提供する（Clerk JWT の sub を返す）。

CREATE OR REPLACE FUNCTION public.can_read_vehicle(vid uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM vehicle_members m
    WHERE m.vehicle_id = vid
      AND m.user_id = auth.user_id()
      AND m.can_read
  );
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.can_write_vehicle(vid uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM vehicle_members m
    WHERE m.vehicle_id = vid
      AND m.user_id = auth.user_id()
      AND m.can_write
  );
END;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.can_read_vehicle(uuid) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.can_write_vehicle(uuid) TO authenticated;