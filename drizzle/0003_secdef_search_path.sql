-- Custom SQL migration file, put your code below! --
-- SECURITY DEFINER 関数に固定の search_path を設定し、search_path 操作による
-- 関数ハイジャックを防ぐ（CREATE OR REPLACE なのでポリシーからの参照は維持される）。
-- auth.user_id() はスキーマ修飾済み、vehicle_members は public で解決する。

CREATE OR REPLACE FUNCTION public.can_read_vehicle(vid uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_catalog
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
  SET search_path = public, pg_catalog
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