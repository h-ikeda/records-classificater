import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';
import { createRoot } from 'react-dom/client';
import config from './firebase';
import App from './App';

const app = initializeApp(config);

// 購読の受信側（WebChannel のバックチャネル）は、既定では応答を開いたままにして
// サーバーからの続きを待つ。この「開きっぱなしのレスポンス」を扱えない経路
// （アプリ内ブラウザ、プロキシ、ウイルス対策など）があり、そこでは張り直しが
// 失敗して購読が黙って止まる。iOS Safari では次のように見える。
//
//   Fetch API cannot load https://firestore.googleapis.com/.../Listen/channel
//   ?...&RID=rpc&...&TYPE=xmlhttp&...  due to access control checks.
//
// 応答を都度閉じるロングポーリングに固定して、この経路差をなくす。多少の
// オーバーヘッドと引き換えに、購読が止まらないことを優先する。
// timeoutSeconds は既定の 30 秒より短くし、途中で切る中継があっても
// こちらから先に閉じられるようにする。
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalLongPollingOptions: { timeoutSeconds: 25 },
});

if (process.env.NODE_ENV !== 'production') {
  connectAuthEmulator(getAuth(), 'http://localhost:9099');
  connectFirestoreEmulator(db, 'localhost', 8080);
}

const container = document.getElementById('root')!;
createRoot(container).render(<App />);
