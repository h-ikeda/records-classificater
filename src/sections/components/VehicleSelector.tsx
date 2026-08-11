import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadVehicleModelOptions, loadVehicleModels, type VehicleModelConfig, type VehicleModelOption } from '../../models';

interface VehicleSummary {
  id: string,
  name: string,
  model?: string,
}

export default function VehicleSelector({
  vehicles,
  currentVehicleId,
  onSelect,
  onUpdateModel,
}: {
  vehicles: VehicleSummary[],
  currentVehicleId: string | null,
  onSelect: (id: string) => void,
  onUpdateModel: (id: string, model: string) => void,
}) {
  const [open, setOpen] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  // 車種レジストリは dynamic import で取得するため、読み込み完了までは空で描画する
  const [models, setModels] = useState<Record<string, VehicleModelConfig>>({});
  const [modelOptions, setModelOptions] = useState<VehicleModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadVehicleModels(), loadVehicleModelOptions()]).then(([m, options]) => {
      if (cancelled) return;
      setModels(m);
      setModelOptions(options);
    }).catch((error) => {
      // 読み込みに失敗しても車両の切り替え自体は行えるため、画像なしで続行する
      console.error('Failed to load vehicle models', error);
    });
    return () => { cancelled = true; };
  }, []);

  function imageFor(model?: string) {
    return model ? models[model]?.image : undefined;
  }

  function labelFor(model?: string) {
    return model ? models[model]?.label : undefined;
  }

  const currentVehicle = vehicles.find(({ id }) => id === currentVehicleId);
  const editingVehicle = vehicles.find(({ id }) => id === editingVehicleId);

  function close() {
    setOpen(false);
    setEditingVehicleId(null);
  }

  function choose(id: string) {
    if (id !== currentVehicleId) onSelect(id);
    close();
  }

  function chooseModel(model: string) {
    if (editingVehicle && model !== editingVehicle.model) onUpdateModel(editingVehicle.id, model);
    setEditingVehicleId(null);
  }

  return (
    <div className="grow min-w-0">
      {/* 現在の車両（タップで選択パネルを開く） */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 py-1.5 px-2.5 rounded-lg border border-gray-300 bg-white active:bg-gray-50"
      >
        {imageFor(currentVehicle?.model) ? (
          <img src={imageFor(currentVehicle?.model)} alt="" className="h-10 w-16 shrink-0 object-contain" />
        ) : (
          <span className="h-10 w-16 shrink-0 flex items-center justify-center text-2xl">🚗</span>
        )}
        <span className="grow min-w-0 truncate text-left text-lg font-medium text-gray-800">
          {currentVehicle?.name ?? '車両を選択'}
        </span>
        <svg className="w-4 h-4 shrink-0 text-gray-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {/* 車両選択パネル（どれを選択中か・どれを選ぼうとしているかを画像で示す）。
          backdrop-blur 付きの sticky ヘッダー内では fixed が効かないため body へ出す */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-40 flex items-start bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div
            className="w-full bg-white rounded-b-2xl px-5 pb-5 max-h-full overflow-y-auto shadow-2xl"
            style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
          >
            {!editingVehicle ? (
              /* 車両一覧 */
              <>
                <h3 className="text-base font-bold text-center mb-3">車両を選択</h3>
                <ul className="space-y-3">
                  {vehicles.map((vehicle) => (
                    <li key={vehicle.id}>
                      <div
                        className={`${vehicle.id === currentVehicleId ? 'border-lime-500 bg-lime-50' : 'border-gray-200 bg-white'} flex items-center gap-3 rounded-xl border-2 p-3`}
                      >
                        <button
                          type="button"
                          onClick={() => choose(vehicle.id)}
                          className="flex items-center gap-3 grow min-w-0 text-left active:scale-[0.98] transition-transform"
                        >
                          {imageFor(vehicle.model) ? (
                            <img src={imageFor(vehicle.model)} alt={labelFor(vehicle.model) ?? ''} className="h-14 w-24 shrink-0 object-contain" />
                          ) : (
                            <span className="h-14 w-24 shrink-0 flex items-center justify-center text-4xl">🚗</span>
                          )}
                          <span className="grow min-w-0">
                            <span className="block truncate text-lg font-bold text-gray-800">{vehicle.name}</span>
                            <span className="block truncate text-xs text-gray-400">{labelFor(vehicle.model) ?? '車種未設定'}</span>
                          </span>
                          {vehicle.id === currentVehicleId && (
                            <span className="shrink-0 text-xs font-bold text-white bg-lime-500 rounded-full px-2.5 py-1">✓ 選択中</span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingVehicleId(vehicle.id)}
                          className="shrink-0 text-xs font-medium text-blue-700 border border-blue-200 rounded-lg px-2.5 py-2 active:bg-blue-50"
                        >
                          車種
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              /* 車種選択 */
              <>
                <div className="flex items-center gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setEditingVehicleId(null)}
                    className="shrink-0 text-sm text-blue-700 py-1 px-1"
                  >
                    ‹ 戻る
                  </button>
                  <h3 className="grow text-base font-bold text-center truncate">{editingVehicle.name} の車種</h3>
                  <span className="w-12 shrink-0"></span>
                </div>
                {!modelOptions.length ? (
                  <p className="text-center text-sm text-gray-400 py-6">車種を読み込み中…</p>
                ) : (
                  <ul className="space-y-3">
                    {modelOptions.map((option) => (
                      <li key={option.id}>
                        <button
                          type="button"
                          onClick={() => chooseModel(option.id)}
                          className={`${option.id === editingVehicle.model ? 'border-lime-500 bg-lime-50' : 'border-gray-200 bg-white active:border-lime-400 active:bg-lime-50'} w-full flex items-center gap-4 rounded-xl border-2 p-3 transition-all active:scale-[0.98]`}
                        >
                          <img src={option.image} alt={option.label} className="h-16 w-28 shrink-0 object-contain" />
                          <span className="grow min-w-0 truncate text-left text-lg font-bold text-gray-800">{option.label}</span>
                          {option.id === editingVehicle.model && (
                            <span className="shrink-0 text-xs font-bold text-white bg-lime-500 rounded-full px-2.5 py-1">✓ 設定中</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
