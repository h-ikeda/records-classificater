import type { Unsubscribe } from 'firebase/firestore';

// Firestore の listen は、稀に初回スナップショットが届かないまま無反応になる
// ことがある（購読は張れているのに、そのターゲットだけサーバーから同期完了が
// 返ってこない）。このときエラーコールバックも呼ばれないため、読み込み完了
// フラグが立たず、ローダーが回り続ける。利用者から見ると「読み込みが止まる。
// リロードすると直る」という症状になる。
//
// 直し方は「購読し直す」だけなので、初回スナップショットが一定時間届かなければ
// 自動でそれを行う。利用者にリロードさせない（＝リロードと同じことを、画面を
// 保ったまま代わりにやる）ための見張り役。

/** 初回スナップショットを待つ時間。過ぎたら購読を張り直す。 */
export const FIRST_SNAPSHOT_TIMEOUT_MS = 8000;

/** 自動で張り直す回数。使い切ったら onStalled で利用者に知らせる。 */
export const MAX_AUTO_RETRIES = 2;

export interface WatchdogOptions {
  /** 初回スナップショットを待つ時間（ミリ秒） */
  timeoutMs?: number,
  /** 自動で張り直す回数 */
  maxRetries?: number,
  /** 張り直しても初回スナップショットが届かなかったときに一度だけ呼ばれる */
  onStalled?: () => void,
  /** 張り直す直前に呼ばれる（何回目かを渡す） */
  onRetry?: (attempt: number) => void,
}

/**
 * onSnapshot の購読を張り、初回スナップショットが時間内に届かなければ
 * 購読を捨てて張り直す。
 *
 * subscribe には onSnapshot を呼んで解除関数を返す関数を渡す。スナップショット
 * またはエラーを受け取ったら、渡される notify を呼ぶこと。notify が一度でも
 * 呼ばれれば見張りは終わり、以降は素通しになる。
 *
 * subscribe は張り直しのたびに呼ばれる。呼ばれた側は、前回分の蓄積（一覧など）を
 * 捨ててから購読し直すこと。同じドキュメントが二重に積まれないようにするため。
 *
 * 戻り値は購読の解除関数。見張りのタイマーも一緒に止まる。
 */
export function subscribeWithWatchdog(
  subscribe: (notify: () => void) => Unsubscribe,
  {
    timeoutMs = FIRST_SNAPSHOT_TIMEOUT_MS,
    maxRetries = MAX_AUTO_RETRIES,
    onStalled,
    onRetry,
  }: WatchdogOptions = {},
): Unsubscribe {
  let unsubscribe: Unsubscribe | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let arrived = false;
  let cancelled = false;

  function clearTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function notify() {
    arrived = true;
    clearTimer();
  }

  function start() {
    unsubscribe = subscribe(notify);
    // subscribe の中で同期的に notify されたなら、見張る必要はない
    if (arrived || cancelled) return;
    timer = setTimeout(() => {
      timer = null;
      if (arrived || cancelled) return;
      // 無反応のターゲットは捨てる。残したままだと、あとから二重に届く
      unsubscribe?.();
      unsubscribe = null;
      if (retries >= maxRetries) {
        onStalled?.();
        return;
      }
      retries += 1;
      onRetry?.(retries);
      start();
    }, timeoutMs);
  }

  start();

  return () => {
    cancelled = true;
    clearTimer();
    unsubscribe?.();
    unsubscribe = null;
  };
}
