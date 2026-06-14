import type { NewTrip, NewVehicle } from './schema';

/**
 * プレビュー DB / ローカル開発用のサンプルデータ。
 * Clerk のテストユーザー ID を渡して、その人が所有する車両と走行記録を生成する。
 */
export function sampleData(userId: string): {
  vehicle: NewVehicle & { id: string };
  member: { vehicleId: string; userId: string; canRead: boolean; canWrite: boolean };
  trips: (Omit<NewTrip, 'vehicleId'> & { id: string })[];
} {
  const vehicleId = '00000000-0000-4000-8000-000000000001';
  const classes = ['業務', '私用'];
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  // 決定的な id を割り当て、onConflictDoNothing で 1 文・冪等にシードできるようにする
  // （neon-http はトランザクション非対応のため、delete→insert ではなく単文で原子的に行う）
  const tid = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
  const trips: (Omit<NewTrip, 'vehicleId'> & { id: string })[] = [
    { id: tid(1), odo: 140, class: '私用', timestamp: new Date(now - 60 * day) },
    { id: tid(2), odo: 199, class: '業務', timestamp: new Date(now - 50 * day) },
    { id: tid(3), odo: 323, class: '業務', timestamp: new Date(now - 20 * day) },
    { id: tid(4), odo: 342, class: '私用', timestamp: new Date(now - 14 * day) },
    { id: tid(5), odo: 369, class: '私用', timestamp: new Date(now - 6 * day) },
    { id: tid(6), odo: 369.9, class: '業務', timestamp: new Date(now - 2 * day) },
    { id: tid(7), odo: 370, class: '私用', timestamp: new Date(now) },
  ];
  return {
    vehicle: { id: vehicleId, name: 'サンプル車両', classes },
    member: { vehicleId, userId, canRead: true, canWrite: true },
    trips,
  };
}
