import * as fs from 'fs';
import * as path from 'path';
import { Timestamp, addDoc, collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteField } from "@firebase/firestore";
import { RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";

// 合成スクリプトは素の CommonJS なので require で読む
const { composeRules, BEGIN, END } = require('../scripts/compose-firestore-rules');

const PRODUCTION_RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

// 実際にデプロイされるのは合成後のルールセットなので、テストもそれに当てる。
// firestore.rules 単体（＝本番用）ではプレビューのパスにルールが無い。
const COMPOSED_RULES: string = composeRules({
  production: PRODUCTION_RULES,
  previews: [{ channel: 'pr-1', rules: PRODUCTION_RULES }],
}).text;

/** 本番用ルールの区間だけを差し替えた、ブランチ側のルールを作る。 */
function withAppRules(body: string): string {
  const start = PRODUCTION_RULES.indexOf(BEGIN) + BEGIN.length;
  const end = PRODUCTION_RULES.indexOf(END);
  return `${PRODUCTION_RULES.slice(0, start)}\n${body}\n${PRODUCTION_RULES.slice(end)}`;
}

function offsetHours(date: Date, hours: number): Date {
  const t = new Date(date);
  t.setHours(t.getHours() + hours);
  return t;
}

// 本番のコレクションはルート直下に、PR プレビューのコレクションは
// preview-channels/pr-<番号>/ 配下に並ぶ。プレビュー側は本番の区間を合成
// スクリプトが入れ子にしたものなので、同じケースを両方のパスへ流して、
// 入れ子にしても判定が変わらないことを確かめる。
const roots: [string, string[]][] = [
  ['production', []],
  ['preview channel', ['preview-channels', 'pr-1']],
];

describe.each(roots)('Firestore security rules (%s)', (_label, root) => {
  // 以降のテストはパスをこの 2 つ経由で組み立て、ルートの違いだけを吸収する
  function document(firestore: any, ...segments: string[]) {
    const [first, ...rest] = [...root, ...segments];
    return doc(firestore, first, ...rest);
  }
  function col(firestore: any, ...segments: string[]) {
    const [first, ...rest] = [...root, ...segments];
    return collection(firestore, first, ...rest);
  }

  let env: RulesTestEnvironment;
  let vid: string;
  let tid: string;
  let uid: string;
  let readOnlyUid: string;
  let writeOnlyUid: string;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-records-classificater',
      firestore: { rules: COMPOSED_RULES },
    });
    uid = crypto.randomUUID().replace('-', '');
    readOnlyUid = crypto.randomUUID().replace('-', '');
    writeOnlyUid = crypto.randomUUID().replace('-', '');
    await env.withSecurityRulesDisabled(async (ctx) => {
      const firestore = ctx.firestore();
      ({ id: vid } = await addDoc(col(firestore, 'vehicles'), {
        permissions: {
          read: [uid, readOnlyUid],
          write: [uid, writeOnlyUid],
        },
        classes: ['Business', 'Private'],
        name: 'カローラ',
      }));
      ({ id: tid } = await addDoc(col(firestore, 'vehicles', vid, 'trips'), {
        timestamp: Timestamp.fromDate(offsetHours(new Date(), -2)),
        odo: 2.3,
        class: 'Business',
      }));
      await setDoc(document(firestore, 'users', uid), {
        state: {
          vehicle: vid,
        },
      });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  describe('in users collection', () => {
    test('an user can create own document', async () => {
      const user = crypto.randomUUID().replace('-', '');
      await assertSucceeds(setDoc(document(env.authenticatedContext(user).firestore(), 'users', user), {
        state: { vehicle: vid },
      }));
    });
    test('an user cannot create a document with incorrect fields', async () => {
      const user = crypto.randomUUID().replace('-', '');
      const firestore = env.authenticatedContext(user).firestore();
      await Promise.all([
        assertFails(setDoc(document(firestore, 'users', user), {
          state: { vehicle: 0 },
        })),
        assertFails(setDoc(document(firestore, 'users', user), {
          state: { incorrectKey: vid },
        })),
        assertFails(setDoc(document(firestore, 'users', user), {
          state: {},
        })),
        assertFails(setDoc(document(firestore, 'users', user), {
          incorrectKey: { vehicle: vid },
        })),
        assertFails(setDoc(document(firestore, 'users', user), {
          incorrectKey: 'some',
        })),
        assertFails(setDoc(document(firestore, 'users', user), {})),
      ]);
    });
    test('an user cannot create other user\'s document', async () => {
      await assertFails(addDoc(col(env.authenticatedContext(uid).firestore(), 'users'), {
        state: { vehicle: vid },
      }));
    });
    test('an unauthenticated user cannot create a document', async () => {
      await assertFails(addDoc(col(env.unauthenticatedContext().firestore(), 'users'), {
        state: { vehicle: vid },
      }));
    });
    test('an user can update state.vehicle field', async () => {
      const { id: vehicle } = await addDoc(col(env.authenticatedContext(uid).firestore(), 'vehicles'), {
        classes: ['S'],
        name: 'ランサー',
        permissions: {
          read: [uid],
          write: [uid],
        },
      });
      await assertSucceeds(updateDoc(document(env.authenticatedContext(uid).firestore(), 'users', uid), {
        state: { vehicle },
      }));
      await assertSucceeds(updateDoc(document(env.authenticatedContext(uid).firestore(), 'users', uid), {
        'state.vehicle': vid,
      }));
    });
    test('an user cannot update with incorrect values', async () => {
      await Promise.all([
        assertFails(updateDoc(document(env.authenticatedContext(uid).firestore(), 'users', uid), {
          state: { vehicle: 0 },
        })),
        assertFails(updateDoc(document(env.authenticatedContext(uid).firestore(), 'users', uid), {
          state: { unapproved: vid },
        })),
        assertFails(updateDoc(document(env.authenticatedContext(uid).firestore(), 'users', uid), {
          'state.vehicle': 0,
        })),
        assertFails(updateDoc(document(env.authenticatedContext(uid).firestore(), 'users', uid), {
          'state.unapproved': vid,
        })),
        assertFails(updateDoc(document(env.authenticatedContext(uid).firestore(), 'users', uid), {
          unapproved: { vehicle: vid },
        })),
        assertFails(updateDoc(document(env.authenticatedContext(uid).firestore(), 'users', uid), {
          'state.vehicle': deleteField(),
        })),
      ]);
    });
    test('an user cannot update other user\'s document', async () => {
      const user = crypto.randomUUID().replace('-', '');
      await Promise.all([
        assertFails(updateDoc(document(env.authenticatedContext(user).firestore(), 'users', uid), {
          state: { vehicle: vid },
        })),
        assertFails(updateDoc(document(env.authenticatedContext(user).firestore(), 'users', uid), {
         'state.vehicle': vid,
        })),
      ]);
    });
    test('an unauthenticated user cannot update a document', async () => {
      await Promise.all([
        assertFails(updateDoc(document(env.unauthenticatedContext().firestore(), 'users', uid), {
          state: { vehicle: vid },
        })),
        assertFails(updateDoc(document(env.unauthenticatedContext().firestore(), 'users', uid), {
         'state.vehicle': vid,
        })),
      ]);
    });
  });

  describe('in vehicles collection', () => {
    test('new vehicle with correct fields should be accepted', async () => {
      const user = crypto.randomUUID().replace('-', '');
      await Promise.all([
        assertSucceeds(addDoc(col(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          name: 'フィット',
          permissions: {
            write: [user],
            read: [user, crypto.randomUUID().replace('-', '')],
          },
        })),
        assertSucceeds(addDoc(col(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          name: 'フィット',
          permissions: {
            read: [user],
          },
        })),
        assertSucceeds(addDoc(col(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          name: 'フィット',
          permissions: {
            write: [user],
          },
        })),
      ]);
    });
    test('new vehicle without correct fields should be denied', async () => {
      const user = crypto.randomUUID().replace('-', '');
      await Promise.all([
        assertFails(addDoc(col(env.authenticatedContext(user).firestore(), 'vehicles'), {
          name: 'フィット',
          permissions: {
            write: [user],
            read: [user],
          },
        })),
        assertFails(addDoc(col(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: 'ClassString',
          name: 'フィット',
          permissions: {
            write: [user],
            read: [user],
          },
        })),
        assertFails(addDoc(col(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          permissions: {
            write: [user],
            read: [user],
          },
        })),
        assertFails(addDoc(col(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          name: 1,
          permissions: {
            write: [user],
            read: [user],
          },
        })),
        assertFails(addDoc(col(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          name: 'フィット',
        })),
        assertFails(addDoc(col(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          name: 'フィット',
          permissions: {
            write: 'uid',
            read: [user],
          },
        })),
        assertFails(addDoc(col(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          name: 'フィット',
          permissions: {
            write: [user],
            read: 'uid',
          },
        })),
      ]);
    });
    test('new vehicle by an unauthenticated user should be denied', async () => {
      await assertFails(addDoc(col(env.unauthenticatedContext().firestore(), 'vehicles'), {
        classes: ['Class1', 'Class2', 'Class3'],
        name: 'レガシィ',
        permissions: {
          write: [crypto.randomUUID().replace('-', '')],
          read: [crypto.randomUUID().replace('-', '')],
        },
      }));
    });
    test('an user can list readable vehicles', async () => {
      await Promise.all([
        assertSucceeds(getDocs(query(col(env.authenticatedContext(uid).firestore(), 'vehicles'), where('permissions.read', 'array-contains', uid)))),
        assertSucceeds(getDocs(query(col(env.authenticatedContext(readOnlyUid).firestore(), 'vehicles'), where('permissions.read', 'array-contains', readOnlyUid)))),
      ]);
    });
    test('an user cannot list unreadable vehicles', async () => {
      await Promise.all([
        assertFails(getDocs(col(env.authenticatedContext(uid).firestore(), 'vehicles'))),
        assertFails(getDocs(query(col(env.authenticatedContext(writeOnlyUid).firestore(), 'vehicles'), where('permissions.write', 'array-contains', writeOnlyUid)))),
      ]);
    });
    test('an unauthenticated user cannot list vehicles', async () => {
      await assertFails(getDocs(col(env.unauthenticatedContext().firestore(), 'vehicles')));
    });
    test('readable users can get a document', async () => {
      await Promise.all([
        assertSucceeds(getDoc(document(env.authenticatedContext(uid).firestore(), 'vehicles', vid))),
        assertSucceeds(getDoc(document(env.authenticatedContext(readOnlyUid).firestore(), 'vehicles', vid))),
      ]);
    });
    test('non readable users cannot get a document', async () => {
      await Promise.all([
        assertFails(getDoc(document(env.authenticatedContext(writeOnlyUid).firestore(), 'vehicles', vid))),
        assertFails(getDoc(document(env.authenticatedContext(crypto.randomUUID().replace('-', '')).firestore(), 'vehicles', vid))),
      ]);
    });
    test('a write permitted user can update name and classes', async () => {
      await Promise.all([
        assertSucceeds(updateDoc(document(env.authenticatedContext(uid).firestore(), 'vehicles', vid), {
          name: 'クラウン',
          classes: ['Business', 'Private', 'Commute'],
        })),
        assertSucceeds(updateDoc(document(env.authenticatedContext(writeOnlyUid).firestore(), 'vehicles', vid), {
          name: 'プリウス',
        })),
        assertSucceeds(updateDoc(document(env.authenticatedContext(uid).firestore(), 'vehicles', vid), {
          'permissions.read': [uid, readOnlyUid, crypto.randomUUID().replace('-', '')],
        })),
      ]);
    });
    test('update with incorrect values should be denied', async () => {
      await Promise.all([
        assertFails(updateDoc(document(env.authenticatedContext(uid).firestore(), 'vehicles', vid), {
          name: 123,
        })),
        assertFails(updateDoc(document(env.authenticatedContext(uid).firestore(), 'vehicles', vid), {
          classes: 'NotAList',
        })),
        assertFails(updateDoc(document(env.authenticatedContext(uid).firestore(), 'vehicles', vid), {
          unapproved: 'value',
        })),
        assertFails(updateDoc(document(env.authenticatedContext(uid).firestore(), 'vehicles', vid), {
          'permissions.write': 'uid',
        })),
      ]);
    });
    test('a read only user cannot update a vehicle', async () => {
      await assertFails(updateDoc(document(env.authenticatedContext(readOnlyUid).firestore(), 'vehicles', vid), {
        name: 'カムリ',
      }));
    });
    test('an unauthenticated user cannot update a vehicle', async () => {
      await assertFails(updateDoc(document(env.unauthenticatedContext().firestore(), 'vehicles', vid), {
        name: 'カムリ',
      }));
    });

    describe('in trips collection', () => {
      test('new trip by a permitted user should be accepted', async () => {
        await Promise.all([
          assertSucceeds(addDoc(col(env.authenticatedContext(uid).firestore(), 'vehicles', vid, 'trips'), {
            timestamp: Timestamp.fromDate(new Date()),
            odo: 12.3,
            class: 'Business',
          })),
          assertSucceeds(addDoc(col(env.authenticatedContext(writeOnlyUid).firestore(), 'vehicles', vid, 'trips'), {
            timestamp: Timestamp.fromDate(offsetHours(new Date(), 1)),
            odo: 45.6,
            class: 'Private',
          })),
        ]);
      });
      test('new trip with incorrect class should be denied', async () => {
        await Promise.all([
          assertFails(addDoc(col(env.authenticatedContext(uid).firestore(), 'vehicles', vid, 'trips'), {
            timestamp: Timestamp.fromDate(offsetHours(new Date(), -1)),
            odo: 6.4,
            class: 'NotSpecified',
          })),
          assertFails(addDoc(col(env.authenticatedContext(uid).firestore(), 'vehicles', vid, 'trips'), {
            timestamp: Timestamp.fromDate(offsetHours(new Date(), -1)),
            odo: 6.3,
          })),
        ]);
      });
      test('new trip by a read only user should be denied', async () => {
        await assertFails(addDoc(col(env.authenticatedContext(readOnlyUid).firestore(), 'vehicles', vid, 'trips'), {
          timestamp: Timestamp.fromDate(new Date()),
          odo: 12.3,
          class: 'Business',
        }));
      });
      test('new trip by an unauthenticated user should be denied', async () => {
        await assertFails(addDoc(col(env.unauthenticatedContext().firestore(), 'vehicles', vid, 'trips'), {
          timestamp: Timestamp.fromDate(new Date()),
          odo: 12.3,
          class: 'Business',
        }));
      });
      test('a permitted user can get a trip', async () => {
        await Promise.all([
          assertSucceeds(getDoc(document(env.authenticatedContext(uid).firestore(), 'vehicles', vid, 'trips', tid))),
          assertSucceeds(getDoc(document(env.authenticatedContext(readOnlyUid).firestore(), 'vehicles', vid, 'trips', tid))),
        ]);
      });
      test('an unauthenticated user cannot get a trip', async () => {
        await assertFails(getDoc(document(env.unauthenticatedContext().firestore(), 'vehicles', vid, 'trips', tid)));
      });
      test('a write only user cannot get a trip', async () => {
        await assertFails(getDoc(document(env.authenticatedContext(writeOnlyUid).firestore(), 'vehicles', vid, 'trips', tid)));
      });
      test('a permitted user can list trips', async () => {
        await Promise.all([
          assertSucceeds(getDocs(col(env.authenticatedContext(uid).firestore(), 'vehicles', vid, 'trips'))),
          assertSucceeds(getDocs(col(env.authenticatedContext(readOnlyUid).firestore(), 'vehicles', vid, 'trips'))),
        ]);
      });
      test('an unauthenticated user cannot list trips', async () => {
        await assertFails(getDocs(col(env.unauthenticatedContext().firestore(), 'vehicles', vid, 'trips')));
      });
      test('a write only user cannot get a trip', async () => {
        await assertFails(getDocs(col(env.authenticatedContext(writeOnlyUid).firestore(), 'vehicles', vid, 'trips')));
      });
    });
  });
});

// ここからは「合成」そのものの性質を確かめる。本番のパスを支配するのは常に
// main のルールで、各 PR のルールはその PR のチャンネルの外へ出られない、という
// のがこの仕組みの拠り所なので、実際に動かして確認する。

const ESCAPING_RULES = withAppRules(`
      match /harmless/{id} {
        allow read: if true;
      }
    }
  }
  match /databases/{database}/documents {
    match /vehicles/{vid} {
      allow read, write: if true;
    }
`);

const PERMISSIVE_RULES = withAppRules(`
      match /{document=**} {
        allow read, write: if true;
      }
`);

describe('rules composition', () => {
  test('入れ子を抜け出そうとする区間は、そのチャンネルのデプロイでは失敗する', () => {
    // 包んでいる match を閉じてから、本番のパスに規則を足そうとする。
    // 括弧の総数は合っているので、深さを見ていないと通ってしまう。
    expect(() => composeRules({
      production: PRODUCTION_RULES,
      previews: [{ channel: 'pr-1', rules: ESCAPING_RULES }],
      requiredChannel: 'pr-1',
    })).toThrow(/閉じ括弧が多すぎます|match \/databases/);
  });

  test('壊れた PR のルールは飛ばされ、ほかの PR のデプロイは止まらない', () => {
    const composed = composeRules({
      production: PRODUCTION_RULES,
      previews: [
        { channel: 'pr-1', rules: ESCAPING_RULES },
        { channel: 'pr-2', rules: PRODUCTION_RULES },
      ],
      requiredChannel: 'pr-2',
    });
    expect(composed.included).toEqual(['pr-2']);
    expect(composed.skipped.map((s: { channel: string }) => s.channel)).toEqual(['pr-1']);
  });

  test('チャンネル名が pr-<番号> でなければ組み込まれない', () => {
    expect(() => composeRules({
      production: PRODUCTION_RULES,
      previews: [{ channel: 'staging', rules: PRODUCTION_RULES }],
      requiredChannel: 'staging',
    })).toThrow(/チャンネル名/);
  });

  test('ルートの絶対参照が想定外の書き方なら拒否される', () => {
    const odd = withAppRules(`
      match /vehicles/{vid} {
        allow get: if get(/databases/(default)/documents/vehicles/$(vid)).data.open == true;
      }
    `);
    expect(() => composeRules({
      production: PRODUCTION_RULES,
      previews: [{ channel: 'pr-1', rules: odd }],
      requiredChannel: 'pr-1',
    })).toThrow(/ルートの絶対参照/);
  });

  test('区間の目印が無いファイルは拒否される', () => {
    expect(() => composeRules({ production: "rules_version = '2';" }))
      .toThrow(/区間の目印/);
  });
});

// チャンネルごとに別々のルールを持てること、そしてどれだけ緩いルールを持ち込んでも
// 自分のチャンネルの外（本番のパスも、ほかの PR のチャンネルも）には届かないこと。
describe('Firestore security rules (per-channel rules)', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-records-classificater',
      firestore: {
        rules: composeRules({
          production: PRODUCTION_RULES,
          previews: [
            // pr-1 は「何でも許す」ルール、pr-2 は本番と同じルール
            { channel: 'pr-1', rules: PERMISSIVE_RULES },
            { channel: 'pr-2', rules: PRODUCTION_RULES },
          ],
        }).text,
      },
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  test('緩いルールを持ち込んだチャンネルでは、そのとおりに緩い', async () => {
    const firestore = env.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(firestore, 'preview-channels', 'pr-1', 'anything', 'x'), { a: 1 }));
  });

  test('ほかのチャンネルは巻き込まれず、自分のルールのままになる', async () => {
    const firestore = env.unauthenticatedContext().firestore();
    await Promise.all([
      assertFails(setDoc(doc(firestore, 'preview-channels', 'pr-2', 'anything', 'x'), { a: 1 })),
      assertFails(setDoc(doc(firestore, 'preview-channels', 'pr-2', 'vehicles', 'x'), { a: 1 })),
    ]);
  });

  test('本番のパスは main のルールのままで、どのチャンネルのルールも届かない', async () => {
    const firestore = env.unauthenticatedContext().firestore();
    await Promise.all([
      assertFails(setDoc(doc(firestore, 'vehicles', 'x'), { a: 1 })),
      assertFails(setDoc(doc(firestore, 'users', 'x'), { state: { vehicle: 'v' } })),
      assertFails(setDoc(doc(firestore, 'trips', 'x'), { data: [] })),
      assertFails(getDoc(doc(firestore, 'vehicles', 'x'))),
    ]);
  });

  test('本番のパスの検証は、認証済みでも main のルールで判断される', async () => {
    const user = crypto.randomUUID().replace('-', '');
    const firestore = env.authenticatedContext(user).firestore();
    await assertFails(setDoc(doc(firestore, 'users', user), { unapproved: 'value' }));
  });

  test('組み込まれていないチャンネルには、どのルールも当たらない', async () => {
    // チャンネルのパスは literal で並べるため、開いている PR に対応しない
    // チャンネルはルール不在＝拒否になる（後片付けの届かないデータを作れない）。
    const user = crypto.randomUUID().replace('-', '');
    const firestore = env.authenticatedContext(user).firestore();
    await Promise.all([
      assertFails(setDoc(doc(firestore, 'preview-channels', 'pr-999', 'users', user), {
        state: { vehicle: 'v' },
      })),
      assertFails(addDoc(collection(firestore, 'preview-channels', 'staging', 'vehicles'), {
        classes: ['Business'],
        name: 'カローラ',
        permissions: { read: [user], write: [user] },
      })),
    ]);
  });
});
