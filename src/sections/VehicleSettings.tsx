import { useAuth } from '@clerk/clerk-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getUserState, getVehicle, shareVehicle, updateVehicle } from '../db/queries';
import Loader from '../components/Loader';

export default function VehicleSettings({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const { getToken } = useAuth();
  const [currentVehicleId, setCurrentVehicleId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  // 走行種別（business / private など）のマスタ。
  // 削除・並び替え時に入力状態がずれないよう、各項目に安定した id を持たせる
  const [classes, setClasses] = useState<{ id: string; value: string }[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // フォームへ初期値を反映済みかどうか
  const initialized = useRef(false);

  const token = useCallback(async () => (await getToken()) ?? '', [getToken]);

  // 現在選択中の車両 ID を取得する
  useEffect(() => {
    (async () => {
      const state = await getUserState(await token(), userId);
      setCurrentVehicleId(state?.vehicleId ?? null);
    })();
  }, [token, userId]);

  // 対象車両の現在値を読み込み、フォームの初期値とする
  useEffect(() => {
    setLoaded(false);
    setError('');
    initialized.current = false;
    if (!currentVehicleId) {
      setName('');
      setClasses([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const data = await getVehicle(await token(), currentVehicleId);
        if (!active || initialized.current) return;
        if (!data) {
          setName('');
          setClasses([]);
          setError('車両情報が見つかりません');
          setLoaded(true);
          return;
        }
        initialized.current = true;
        setName(data.name);
        setClasses(data.classes.map((value) => ({ id: crypto.randomUUID(), value })));
        setLoaded(true);
      } catch {
        if (!active) return;
        setName('');
        setClasses([]);
        setError('車両情報の読み込みに失敗しました');
        setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [currentVehicleId, token]);

  function updateClass(id: string, value: string) {
    setClasses((prev) => prev.map((c) => (c.id === id ? { ...c, value } : c)));
  }

  function removeClass(id: string) {
    setClasses((prev) => prev.filter((c) => c.id !== id));
  }

  function addClass() {
    setClasses((prev) => [...prev, { id: crypto.randomUUID(), value: '' }]);
  }

  // 共有は権限の追加であり、フォームの保存とは独立してその場で反映する
  async function share() {
    if (!currentVehicleId) return;
    const id = prompt('共有相手のIDを入力してください');
    if (!id?.trim()) return;
    try {
      await shareVehicle(await token(), currentVehicleId, id.trim());
    } catch {
      setError('共有の追加に失敗しました');
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!currentVehicleId) return;
    const trimmedName = name.trim();
    // 空欄を除き、前後の空白を整理する
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
      await updateVehicle(await token(), currentVehicleId, {
        name: trimmedName,
        classes: trimmedClasses,
      });
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

        {!currentVehicleId ? (
          <p className="text-center text-sm text-gray-500 py-8">車両が選択されていません</p>
        ) : !loaded ? (
          <Loader className="text-lime-500 text-3xl py-8" />
        ) : (
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
      </div>
    </div>
  );
}
