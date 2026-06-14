'use client';

import { useEffect, useRef, useState } from 'react';

function toLocalInputValue(d) {
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function NewTrip({ minOdo = 0, classOptions = /** @type {string[]} */ ([]), onSubmit, onCancel }) {
  const odoInput = useRef(null);
  const [newODO, setNewODO] = useState(minOdo > 0 ? minOdo : 0);
  const [newClass, setNewClass] = useState(classOptions[0]);
  // 既定値は現在時刻。必要に応じて入力欄で調整する。
  const [dateTimeLocal, setDateTimeLocal] = useState(() => toLocalInputValue(new Date()));
  const [error, setError] = useState('');

  useEffect(() => {
    setNewClass((prev) => (classOptions.includes(prev) ? prev : classOptions[0]));
  }, [classOptions]);

  useEffect(() => {
    setNewODO((odo) => (odo < minOdo ? minOdo : odo));
  }, [minOdo]);

  useEffect(() => {
    odoInput.current?.focus();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    const date = new Date(dateTimeLocal);
    if (isNaN(date.getTime())) {
      setError('記録日時が正しくありません');
      return;
    }
    if (!newClass) {
      setError('分類を選択してください');
      return;
    }
    if (typeof newODO !== 'number' || isNaN(newODO)) {
      setError('総走行距離 (ODO) を入力してください');
      return;
    }
    if (newODO < minOdo) {
      setError(`総走行距離 (ODO) は ${minOdo} km 以上で入力してください`);
      return;
    }
    // onSubmit は却下時に理由（文字列）を返す。成功時は null。
    const rejection = await onSubmit({
      timestamp: date.toISOString(),
      odo: newODO,
      class: newClass,
    });
    if (rejection) setError(rejection);
  }

  return (
    <form className="space-y-2" onSubmit={handleSubmit}>
      <h3 className="text-base font-bold text-center">走行記録を追加</h3>

      {/* ODO */}
      <label className="block">
        <span className="text-xs font-medium text-gray-600">総走行距離 (ODO)</span>
        <div className="flex items-baseline gap-2">
          <input
            ref={odoInput}
            value={Number.isNaN(newODO) ? '' : newODO}
            onChange={(e) => setNewODO(e.target.valueAsNumber)}
            type="number"
            inputMode="decimal"
            step="any"
            min={minOdo}
            className="w-full text-2xl font-bold tabular-nums border-b-2 border-lime-500 bg-transparent focus:outline-none"
          />
          <span className="text-base text-gray-500">km</span>
        </div>
        {minOdo > 0 && <p className="text-xs text-gray-400">前回の記録: {minOdo} km</p>}
      </label>

      {/* 分類 */}
      <div>
        <span className="text-xs font-medium text-gray-600">分類</span>
        <div className="flex flex-wrap gap-2 mt-1">
          {classOptions.map((classOption) => (
            <button
              key={classOption}
              type="button"
              onClick={() => setNewClass(classOption)}
              className={`${newClass === classOption
                ? 'bg-lime-500 text-white border-lime-500'
                : 'bg-white text-gray-700 border-gray-300'} px-4 py-1.5 rounded-full text-base font-medium border-2 transition-colors active:scale-95`}
            >
              {classOption}
            </button>
          ))}
        </div>
      </div>

      {/* 記録日時 */}
      <label className="block">
        <span className="text-xs font-medium text-gray-600">記録日時</span>
        <input
          value={dateTimeLocal}
          onChange={(e) => setDateTimeLocal(e.target.value)}
          type="datetime-local"
          step="1"
          className="w-full text-base border rounded-lg px-3 py-2 mt-1 border-gray-300 focus:outline-none focus:border-lime-500"
        />
      </label>

      {/* エラー表示 */}
      {error && <p className="text-sm text-red-600 text-center" role="alert">{error}</p>}

      {/* 操作 */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border-2 border-gray-300 text-gray-600 rounded-xl py-2.5 font-medium active:bg-gray-100"
        >
          キャンセル
        </button>
        <button
          type="submit"
          className="flex-1 bg-lime-500 text-white rounded-xl py-2.5 font-bold shadow active:bg-lime-600"
        >
          記録する
        </button>
      </div>
    </form>
  );
}
