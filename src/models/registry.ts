// 車種(model)ごとの設定。今回は画像のみだが、将来的に既定の分類などを足せる。
//
// ⚠️ ここのキー(golf7, n-one ...)が Firestore の vehicles.model に保存される値で、
//    そのまま車種の識別子になる。新しい車種を追加するときは、
//    firestore.rules の isAllowedVehicleModel() の許可リストにも
//    同じキーを追加すること（ルールは JS を参照できないため二重管理になる）。
export interface VehicleModelConfig {
  /** 一覧やラベルに表示する名称 */
  label: string;
  /** 車種の画像URL */
  image: string;
}

export const vehicleModels = {
  golf7: {
    label: 'Volkswagen Golf 7',
    image: new URL('../img/vehicles/Golf7.png', import.meta.url).href,
  },
  'n-one': {
    label: 'Honda N-ONE',
    image: new URL('../img/vehicles/N-One.png', import.meta.url).href,
  },
} satisfies Record<string, VehicleModelConfig>;

export type VehicleModelId = keyof typeof vehicleModels;
