import * as fs from 'fs';
import * as path from 'path';
import { Timestamp, addDoc, collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteField } from "@firebase/firestore";
import { RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";

// 合成スクリプトは素の CommonJS なので require で読む
const { composeRules, BEGIN, END } = require('../scripts/compose-firestore-rules');

const PRODUCTION_RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

// 実際にデプロイされるのは合成後のルールセットなので、テストもそれに当てる。
// firestore.rules 単体（＝本番用）ではプレビューのパスにルールが無い。
const COMPOSED_RULES = composeRules({ production: PRODUCTION_RULES });

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
// main のルールで、ブランチのルールはプレビューのパスの外へ出られない、という
// のがこの仕組みの拠り所なので、その 2 つを実際に動かして確認する。
describe('rules composition', () => {
  test('入れ子を抜け出そうとする区間は合成時に拒否される', () => {
    // 包んでいる match を閉じてから、本番のパスに規則を足そうとする。
    // 括弧の総数は合っているので、深さを見ていないと通ってしまう。
    const escaping = withAppRules(`
      match /harmless/{id} {
        allow read: if true;
      }
    }
  }
  match /databases/{database}/documents {
    match /vehicles/{vid} {
      allow read, write: if true;
    `);
    expect(() => composeRules({ production: PRODUCTION_RULES, preview: escaping }))
      .toThrow(/閉じ括弧が多すぎます|match \/databases/);
  });

  test('ルートの絶対参照が想定外の書き方なら拒否される', () => {
    const odd = withAppRules(`
      match /vehicles/{vid} {
        allow get: if get(/databases/(default)/documents/vehicles/$(vid)).data.open == true;
      }
    `);
    expect(() => composeRules({ production: PRODUCTION_RULES, preview: odd }))
      .toThrow(/ルートの絶対参照/);
  });

  test('区間の目印が無いファイルは拒否される', () => {
    expect(() => composeRules({ production: "rules_version = '2';" }))
      .toThrow(/区間の目印/);
  });
});

// ブランチのルールがどれだけ緩くても、本番のパスには一切届かないこと。
// これが崩れると、PR がルールを書き換えるだけで本番のデータに手が届く。
describe('Firestore security rules (a permissive branch ruleset)', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    // 「何でも許す」ブランチのルールで合成する
    const permissive = withAppRules(`
      match /{document=**} {
        allow read, write: if true;
      }
    `);
    env = await initializeTestEnvironment({
      projectId: 'demo-records-classificater',
      firestore: {
        rules: composeRules({ production: PRODUCTION_RULES, preview: permissive }),
      },
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  test('プレビューのパスにはブランチのルールが効く', async () => {
    // 未認証でも通る = 差し替えたルールが確かに適用されている
    const firestore = env.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(firestore, 'preview-channels', 'pr-1', 'anything', 'x'), { a: 1 }));
  });

  test('本番のパスは main のルールのままで、ブランチのルールは届かない', async () => {
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
    // main のルールは users に state 以外のキーを許さない
    await assertFails(setDoc(doc(firestore, 'users', user), { unapproved: 'value' }));
  });
});
