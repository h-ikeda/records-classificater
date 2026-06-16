CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"odo" double precision NOT NULL,
	"class" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_states" (
	"user_id" text PRIMARY KEY NOT NULL,
	"vehicle_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vehicle_members" (
	"vehicle_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"can_read" boolean DEFAULT true NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	CONSTRAINT "vehicle_members_vehicle_id_user_id_pk" PRIMARY KEY("vehicle_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "vehicle_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"classes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_states" ADD CONSTRAINT "user_states_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_members" ADD CONSTRAINT "vehicle_members_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "trips_select" ON "trips" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.can_read_vehicle("trips"."vehicle_id"));--> statement-breakpoint
CREATE POLICY "trips_insert" ON "trips" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.can_write_vehicle("trips"."vehicle_id") and exists (
        select 1 from vehicles v
        where v.id = "trips"."vehicle_id"
          and "trips"."class" = any(v.classes)
      ));--> statement-breakpoint
CREATE POLICY "trips_update" ON "trips" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (public.can_write_vehicle("trips"."vehicle_id"));--> statement-breakpoint
CREATE POLICY "trips_delete" ON "trips" AS PERMISSIVE FOR DELETE TO "authenticated" USING (public.can_write_vehicle("trips"."vehicle_id"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "user_states" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.user_id() = "user_states"."user_id"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "user_states" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.user_id() = "user_states"."user_id"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "user_states" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.user_id() = "user_states"."user_id")) WITH CHECK ((select auth.user_id() = "user_states"."user_id"));--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "user_states" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.user_id() = "user_states"."user_id"));--> statement-breakpoint
CREATE POLICY "vehicle_members_select" ON "vehicle_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("vehicle_members"."user_id" = (select auth.user_id()));--> statement-breakpoint
CREATE POLICY "vehicle_members_insert" ON "vehicle_members" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("vehicle_members"."user_id" = (select auth.user_id()) or public.can_write_vehicle("vehicle_members"."vehicle_id"));--> statement-breakpoint
CREATE POLICY "vehicle_members_update" ON "vehicle_members" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (public.can_write_vehicle("vehicle_members"."vehicle_id"));--> statement-breakpoint
CREATE POLICY "vehicle_members_delete" ON "vehicle_members" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("vehicle_members"."user_id" = (select auth.user_id()) or public.can_write_vehicle("vehicle_members"."vehicle_id"));--> statement-breakpoint
CREATE POLICY "vehicles_select" ON "vehicles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.can_read_vehicle("vehicles"."id"));--> statement-breakpoint
CREATE POLICY "vehicles_insert" ON "vehicles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "vehicles_update" ON "vehicles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (public.can_write_vehicle("vehicles"."id")) WITH CHECK (public.can_write_vehicle("vehicles"."id"));--> statement-breakpoint
CREATE POLICY "vehicles_delete" ON "vehicles" AS PERMISSIVE FOR DELETE TO "authenticated" USING (public.can_write_vehicle("vehicles"."id"));