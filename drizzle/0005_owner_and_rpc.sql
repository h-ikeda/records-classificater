-- 車両に所有者(owner_id)を導入し、所有者ベースの権限判定へ移行する。
-- あわせて、車両作成とアカウントデータ削除を原子的に行う RPC を追加する。

-- 1) owner_id 列の追加。既存行は write 権限メンバーを所有者として補完してから NOT NULL 化する。
ALTER TABLE "vehicles" ADD COLUMN "owner_id" text;--> statement-breakpoint
UPDATE "vehicles" v SET "owner_id" = (
  SELECT m.user_id FROM "vehicle_members" m
  WHERE m.vehicle_id = v.id AND m.can_write
  ORDER BY m.user_id
  LIMIT 1
) WHERE v."owner_id" IS NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint

-- 2) 所有者判定関数。SECURITY DEFINER で RLS をバイパスし、vehicle_members ポリシーの
-- 自己再帰を避けつつ「この車両の所有者か」を判定する。search_path は固定し、参照は修飾する。
CREATE OR REPLACE FUNCTION public.is_vehicle_owner(vid uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = vid
      AND v.owner_id = auth.user_id()
  );
END;
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_vehicle_owner(uuid) TO authenticated;--> statement-breakpoint

-- 3) ポリシーの更新（所有者ベースへ）。関数定義後に実行する必要がある。
ALTER POLICY "trips_update" ON "trips" TO authenticated USING (public.can_write_vehicle("trips"."vehicle_id")) WITH CHECK (public.can_write_vehicle("trips"."vehicle_id") and exists (
        select 1 from vehicles v
        where v.id = "trips"."vehicle_id"
          and "trips"."class" = any(v.classes)
      ));--> statement-breakpoint
ALTER POLICY "vehicle_members_insert" ON "vehicle_members" TO authenticated WITH CHECK (public.is_vehicle_owner("vehicle_members"."vehicle_id"));--> statement-breakpoint
ALTER POLICY "vehicle_members_update" ON "vehicle_members" TO authenticated USING (public.is_vehicle_owner("vehicle_members"."vehicle_id")) WITH CHECK (public.is_vehicle_owner("vehicle_members"."vehicle_id"));--> statement-breakpoint
ALTER POLICY "vehicle_members_delete" ON "vehicle_members" TO authenticated USING ("vehicle_members"."user_id" = (select auth.user_id()) or public.is_vehicle_owner("vehicle_members"."vehicle_id"));--> statement-breakpoint
ALTER POLICY "vehicles_insert" ON "vehicles" TO authenticated WITH CHECK ("vehicles"."owner_id" = (select auth.user_id()));--> statement-breakpoint
ALTER POLICY "vehicles_delete" ON "vehicles" TO authenticated USING (public.is_vehicle_owner("vehicles"."id"));--> statement-breakpoint

-- 4) 車両作成を原子的に行う RPC。vehicle・所有者メンバー・current vehicle を 1 トランザクションで投入する。
-- SECURITY DEFINER で RLS をバイパスするため、所有者の初期メンバー登録が可能。
CREATE OR REPLACE FUNCTION public.create_vehicle(p_name text, p_classes text[])
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_user text := auth.user_id();
  v_id uuid := gen_random_uuid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  INSERT INTO public.vehicles (id, owner_id, name, classes)
    VALUES (v_id, v_user, p_name, coalesce(p_classes, '{}'::text[]));
  INSERT INTO public.vehicle_members (vehicle_id, user_id, can_read, can_write)
    VALUES (v_id, v_user, true, true);
  INSERT INTO public.user_states (user_id, vehicle_id, updated_at)
    VALUES (v_user, v_id, now())
    ON CONFLICT (user_id) DO UPDATE
      SET vehicle_id = excluded.vehicle_id, updated_at = excluded.updated_at;
  RETURN v_id;
END;
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_vehicle(text, text[]) TO authenticated;--> statement-breakpoint

-- 5) アカウント削除時に Neon 側のデータを掃除する RPC。Clerk のユーザー削除前に呼ぶ。
-- 所有する車両（trips / vehicle_members は cascade）と、共有先メンバー行・自分の状態を削除する。
CREATE OR REPLACE FUNCTION public.delete_my_account_data()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_user text := auth.user_id();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  DELETE FROM public.vehicles WHERE owner_id = v_user;
  DELETE FROM public.vehicle_members WHERE user_id = v_user;
  DELETE FROM public.user_states WHERE user_id = v_user;
END;
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.delete_my_account_data() TO authenticated;
