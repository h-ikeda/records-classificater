import type { VehicleModelConfig } from './registry';

export type { VehicleModelConfig } from './registry';

export interface VehicleModelOption extends VehicleModelConfig {
  id: string;
}

let cache: Promise<Record<string, VehicleModelConfig>> | undefined;

// 車種レジストリは dynamic import で別チャンクに分離し、必要になったときだけ読み込む。
// 画像も registry.ts 経由でのみ参照されるため、初期バンドルには含まれない。
export function loadVehicleModels(): Promise<Record<string, VehicleModelConfig>> {
  if (!cache) cache = import('./registry').then(({ vehicleModels }) => vehicleModels);
  return cache;
}

// 選択肢一覧（id 付き）を取得する。
export async function loadVehicleModelOptions(): Promise<VehicleModelOption[]> {
  const models = await loadVehicleModels();
  return Object.entries(models).map(([id, config]) => ({ id, ...config }));
}
