import type { NewTrip, NewVehicle } from './schema';

/**
 * プレビュー DB / ローカル開発用のサンプルデータ。
 * Clerk のテストユーザー ID を渡して、その人が所有する車両と走行記録を生成する。
 */
export function sampleData(userId: string): {
  vehicle: NewVehicle & { id: string };
  member: { vehicleId: string; userId: string; canRead: boolean; canWrite: boolean };
  trips: Omit<NewTrip, 'vehicleId'>[];
} {
  const vehicleId = '00000000-0000-4000-8000-000000000001';
  const classes = ['業務', '私用'];
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const trips: Omit<NewTrip, 'vehicleId'>[] = [
    { odo: 140, class: '私用', timestamp: new Date(now - 60 * day) },
    { odo: 199, class: '業務', timestamp: new Date(now - 50 * day) },
    { odo: 323, class: '業務', timestamp: new Date(now - 20 * day) },
    { odo: 342, class: '私用', timestamp: new Date(now - 14 * day) },
    { odo: 369, class: '私用', timestamp: new Date(now - 6 * day) },
    { odo: 369.9, class: '業務', timestamp: new Date(now - 2 * day) },
    { odo: 370, class: '私用', timestamp: new Date(now) },
  ];
  return {
    vehicle: { id: vehicleId, name: 'サンプル車両', classes },
    member: { vehicleId, userId, canRead: true, canWrite: true },
    trips,
  };
}
