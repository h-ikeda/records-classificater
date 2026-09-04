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
//
// なお、張り直しても通信そのものはやり直されない。SDK の remote_store は
// listen 中のターゲットが 0 になったときだけ watch ストリームを閉じるため
// （remoteStoreUnlisten）、他の購読が生きている間の張り直しは、開いたままの
// 同じストリームへ新しい listen を送るだけになる。つまりこの見張りが直せるのは
// 「ストリームは生きているのに、そのターゲットだけ応答が来ない」形であって、
// ストリームごと詰まっている場合ではない。原因を特定できたわけではないので、
// 直った／直らなかったのどちらもコンソールへ残す。

// 実環境で「走行記録の購読だけが 8 秒待ってもひとつもスナップショットを
// 返さず、張り直したら即座に届いた」ことを確認済み（PR #458 のプレビュー）。
// 無反応なら早く見切ってよいので、最初の待ちは短くする。
/** 初回スナップショットを待つ時間。過ぎたら購読を張り直す。 */
export const FIRST_SNAPSHOT_TIMEOUT_MS = 5000;

/** 自動で張り直す回数。使い切ったら onStalled で利用者に知らせる。 */
export const MAX_AUTO_RETRIES = 2;

export interface WatchdogOptions {
  /**
   * 購読の名前。張り直したことをコンソールへ残すときに使う。
   *
   * 自動で復帰すると、画面上は「少し遅かった」ようにしか見えず、無反応に
   * なっていた事実が消える。以前この仕組みを外したのも、直ったのか隠れて
   * いるのか区別が付かなくなるためだった。張り直したら必ず記録を残し、
   * 起きていたことを後から確かめられるようにする。
   */
  label?: string,
  /**
   * 初回スナップショットを待つ時間（ミリ秒）。
   *
   * 張り直すたびに倍にする。無反応なら 1 回目で見切りたいので短くしたいが、
   * 単に回線が遅くて時間がかかっているだけの場合、短い待ちで何度も張り直すと
   * いつまでも届かない。回を追うごとに待ちを伸ばして両方に対応する。
   */
  timeoutMs?: number,
  /** 自動で張り直す回数 */
  maxRetries?: number,
  /** 張り直しても初回スナップショットが届かなかったときに一度だけ呼ばれる */
  onStalled?: () => void,
  /**
   * onStalled のあとで初回スナップショットが届いたときに呼ばれる。
   *
   * 諦めたあとも最後の購読は張ったままにしてあるので、通信が戻れば遅れて届く。
   * 呼び出し側は、ここで出しているエラー表示を取り下げること。
   */
  onRecovered?: () => void,
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
    label = '購読',
    timeoutMs = FIRST_SNAPSHOT_TIMEOUT_MS,
    maxRetries = MAX_AUTO_RETRIES,
    onStalled,
    onRecovered,
    onRetry,
  }: WatchdogOptions = {},
): Unsubscribe {
  let unsubscribe: Unsubscribe | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let arrived = false;
  let cancelled = false;
  let stalled = false;
  let startedAt = 0;

  function clearTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function notify() {
    // 張り直した先で届いたなら、何秒かかったかを残す。前の購読が時間内に
    // 何も返さなかったのに次がすぐ返ったなら、回線の遅さではなくその購読が
    // 無反応だったということ。原因を追うための手掛かりになる
    if (!arrived && stalled) {
      console.warn(`${label}: 諦めたあとに初回スナップショットが届いた（諦めてから ${Date.now() - startedAt}ms）`);
      stalled = false;
      onRecovered?.();
    } else if (!arrived && retries > 0) {
      console.warn(`${label}: ${retries} 回目の購読で初回スナップショットが届いた（張り直してから ${Date.now() - startedAt}ms）`);
    }
    arrived = true;
    clearTimer();
  }

  function start() {
    // 張り直すたびに待ちを倍にする
    const wait = timeoutMs * (2 ** retries);
    startedAt = Date.now();
    unsubscribe = subscribe(notify);
    // subscribe の中で同期的に notify されたなら、見張る必要はない
    if (arrived || cancelled) return;
    timer = setTimeout(() => {
      timer = null;
      if (arrived || cancelled) return;
      if (retries >= maxRetries) {
        // ここで購読を捨てると、通信が戻っても二度と届かなくなる。SDK は
        // watch ストリームをバックオフしながら張り直し続けるので、最後の購読は
        // 残したまま利用者に知らせ、遅れて届いたら onRecovered で取り下げる
        console.warn(`${label}: 張り直しても初回スナップショットが届かなかった（${maxRetries} 回）。購読は残したまま待つ`);
        stalled = true;
        startedAt = Date.now();
        onStalled?.();
        return;
      }
      // 無反応のターゲットは捨てる。残したままだと、あとから二重に届く
      unsubscribe?.();
      unsubscribe = null;
      console.warn(`${label}: 初回スナップショットが ${wait}ms 届かないため購読を張り直す（${retries + 1}/${maxRetries} 回目）`);
      retries += 1;
      onRetry?.(retries);
      start();
    }, wait);
  }

  start();

  return () => {
    cancelled = true;
    clearTimer();
    unsubscribe?.();
    unsubscribe = null;
  };
}
