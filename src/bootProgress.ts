// index.html の起動オーバーレイへ進捗を伝えるだけの薄いラッパー。
// オーバーレイは読み込みが終わると DOM ごと消え、インラインスクリプトが
// 動かない環境でも参照できないだけなので、無ければ黙って何もしない。
type BootStep = 'script' | 'firebase' | 'render';

declare global {
  interface Window {
    bootProgress?: {
      advance(step: string): void;
      done(): void;
    };
  }
}

export function advance(step: BootStep): void {
  window.bootProgress?.advance(step);
}

export function done(): void {
  window.bootProgress?.done();
}
