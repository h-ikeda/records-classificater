-- Custom SQL migration file, put your code below! --
-- SECURITY DEFINER 関数の search_path を堅牢化する。
-- 0003 では `public, pg_catalog` を設定していたが、public は authenticated ロールが
-- オブジェクトを作成しうるため、検索パスに含めると関数ハイジャックの余地が残る。
-- 検索パスを `pg_catalog, pg_temp` に固定し、参照する内部オブジェクトはすべて
-- スキーマ修飾する（public.vehicle_members / auth.user_id()）。
-- CREATE OR REPLACE なので、ポリシーからの参照は維持される。

CREATE OR REPLACE FUNCTION public.can_read_vehicle(vid uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.vehicle_members m
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
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.vehicle_members m
    WHERE m.vehicle_id = vid
      AND m.user_id = auth.user_id()
      AND m.can_write
  );
END;
$$;
