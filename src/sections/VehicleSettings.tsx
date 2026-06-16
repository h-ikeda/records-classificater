import { useAuth } from '@clerk/clerk-react';
import { useCallback, useEffect, useState } from 'react';
import {
  createVehicle,
  getUserState,
  listVehicles,
  shareVehicle,
  updateVehicle,
} from '../db/queries';
import type { Vehicle } from '../db/schema';
import Loader from '../components/Loader';

export default function VehicleSettings({
  userId,
  onChanged,
  onClose,
}: {
  userId: string;
  // 車両の追加・更新時に呼び、走行記録画面側を再取得させる
  onChanged: () => void;
  onClose: () => void;
}) {
  const { getToken } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  // 走行種別マスタ。各項目に安定した id を持たせて編集中のずれを防ぐ
  const [classes, setClasses] = useState<{ id: string; value: string }[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const token = useCallback(async () => (await getToken()) ?? '', [getToken]);

  // 指定した車両の値をフォームへ反映する
  const populate = useCallback((list: Vehicle[], id: string | null) => {
    const v = list.find((x) => x.id === id);
    setName(v?.name ?? '');
    setClasses((v?.classes ?? []).map((value) => ({ id: crypto.randomUUID(), value })));
  }, []);

  // 車両一覧と現在選択中の車両を読み込む
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const t = await token();
        const [state, list] = await Promise.all([getUserState(t, userId), listVehicles(t)]);
        if (!active) return;
        const sel =
          state?.vehicleId && list.some((v) => v.id === state.vehicleId)
            ? state.vehicleId
            : list[0]?.id ?? null;
        setVehicles(list);
        setSelectedId(sel);
        populate(list, sel);
      } catch {
        if (active) setError('車両情報の読み込みに失敗しました');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, userId, populate]);

  function handleSelect(event: React.ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    setSelectedId(id);
    setError('');
    populate(vehicles, id);
  }

  async function handleAddVehicle() {
    const inputName = prompt('車の名称を入力してください');
    if (inputName === null) return;
    // 作成と一覧更新を分離。作成成功後に更新だけ失敗しても「追加失敗」と誤表示して
    // 再試行＝重複作成を招かないようにする。
    let id: string;
    try {
      id = await createVehicle(await token(), inputName || '車両', ['業務', '私用']);
    } catch (e) {
      console.error('Failed to create vehicle:', e);
      setError('車両の追加に失敗しました。時間をおいて再度お試しください。');
      return;
    }
    try {
      const list = await listVehicles(await token());
      setVehicles(list);
      setSelectedId(id);
      populate(list, id);
      setError('');
    } catch (e) {
      console.error('Failed to refresh vehicles after add:', e);
      setError('車両は追加されましたが、一覧の更新に失敗しました。画面を閉じて開き直してください。');
    }
    onChanged();
  }

  function updateClass(id: string, value: string) {
    setClasses((prev) => prev.map((c) => (c.id === id ? { ...c, value } : c)));
  }

  function removeClass(id: string) {
    setClasses((prev) => prev.filter((c) => c.id !== id));
  }

  function addClass() {
    setClasses((prev) => [...prev, { id: crypto.randomUUID(), value: '' }]);
  }

  async function share() {
    if (!selectedId) return;
    const id = prompt('共有相手のIDを入力してください');
    if (!id?.trim()) return;
    try {
      await shareVehicle(await token(), selectedId, id.trim());
    } catch {
      setError('共有の追加に失敗しました');
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    const trimmedName = name.trim();
    const trimmedClasses = classes.map((c) => c.value.trim()).filter((c) => c !== '');
    if (!trimmedName) {
      setError('車両名を入力してください');
      return;
    }
    if (new Set(trimmedClasses).size !== trimmedClasses.length) {
      setError('走行種別が重複しています');
      return;
    }
    if (!trimmedClasses.length) {
      setError('走行種別を1つ以上入力してください');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateVehicle(await token(), selectedId, { name: trimmedName, classes: trimmedClasses });
      onChanged();
      onClose();
    } catch {
      setError('保存に失敗しました');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full bg-white rounded-b-2xl px-5 pb-5 max-h-full overflow-y-auto shadow-2xl"
        style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
      >
        <h3 className="text-base font-bold text-center py-1">車両設定</h3>

        {loading ? (
          <Loader className="text-lime-500 text-3xl py-8" />
        ) : (
          <div className="space-y-5">
            {/* 設定する車両の選択 ＋ 追加 */}
            <div>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">設定する車両</span>
                {vehicles.length ? (
                  <select
                    value={selectedId ?? ''}
                    onChange={handleSelect}
                    className="w-full text-lg font-medium py-2 px-3 mt-1 rounded-lg border border-gray-300 bg-white focus:outline-none focus:border-lime-500"
                  >
                    {vehicles.map(({ id, name }) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                ) : !error ? (
                  <p className="text-sm text-gray-500 py-2">車両がありません。下のボタンから追加してください。</p>
                ) : null}
              </label>
              <button
                type="button"
                onClick={handleAddVehicle}
                className="mt-2 text-sm text-lime-700 font-medium active:text-lime-800"
              >
                ＋ 車両を追加
              </button>
            </div>

            {selectedId && (
              <form className="space-y-5" onSubmit={handleSave}>
                {/* 車両名 */}
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">車両名</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    type="text"
                    className="w-full text-lg font-medium border-b-2 border-lime-500 bg-transparent focus:outline-none py-1"
                  />
                </label>

                {/* 走行種別マスタ */}
                <div>
                  <span className="text-xs font-medium text-gray-600">走行種別</span>
                  <ul className="space-y-2 mt-1">
                    {classes.map((cls) => (
                      <li key={cls.id} className="flex items-center gap-2">
                        <input
                          value={cls.value}
                          onChange={(e) => updateClass(cls.id, e.target.value)}
                          type="text"
                          placeholder="例: business / private"
                          className="grow text-base border rounded-lg px-3 py-2 border-gray-300 focus:outline-none focus:border-lime-500"
                        />
                        <button
                          type="button"
                          aria-label="削除"
                          onClick={() => removeClass(cls.id)}
                          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full border border-gray-300 text-gray-500 active:bg-gray-100"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={addClass}
                    className="mt-2 text-sm text-lime-700 font-medium active:text-lime-800"
                  >
                    ＋ 走行種別を追加
                  </button>
                </div>

                {/* 共有 */}
                <div>
                  <span className="text-xs font-medium text-gray-600">共有</span>
                  <button
                    type="button"
                    onClick={share}
                    className="mt-1 block text-sm text-blue-700 font-medium active:text-blue-800"
                  >
                    ＋ 共有相手を追加
                  </button>
                </div>

                {/* エラー表示 */}
                {error && <p className="text-sm text-red-600 text-center" role="alert">{error}</p>}

                {/* 操作 */}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 border-2 border-gray-300 text-gray-600 rounded-xl py-2.5 font-medium active:bg-gray-100"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-lime-500 text-white rounded-xl py-2.5 font-bold shadow active:bg-lime-600 disabled:opacity-60"
                  >
                    保存する
                  </button>
                </div>
              </form>
            )}

            {/* 車両が無いときのエラー表示と閉じる */}
            {!selectedId && (
              <>
                {error && <p className="text-sm text-red-600 text-center" role="alert">{error}</p>}
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full text-sm text-gray-500 py-2 active:text-gray-700"
                >
                  閉じる
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
