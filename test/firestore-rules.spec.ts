import { Timestamp, addDoc, collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteField } from "@firebase/firestore";
import { RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";

function offsetHours(date: Date, hours: number): Date {
  const t = new Date(date);
  t.setHours(t.getHours() + hours);
  return t;
}

// 本番のコレクションはルート直下に、PR プレビューのコレクションは
// preview-channels/pr-<番号>/ 配下に並ぶ（firestore.rules 参照）。判定条件は
// 共通の関数にまとめてあるが、match の入れ子は二重に書かれているため、同じ
// ケースを両方のパスへ流して差が出ないことを確かめる。
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

// preview-channels 配下は PR 番号のチャンネルだけを許す。ここが緩いと、後片付け
// （preview-cleanup.yml は preview-channels/pr-<番号> だけを消す）の届かない
// データを作れてしまう。
describe('Firestore security rules (preview channel name)', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-records-classificater',
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  test('a channel not named pr-<number> is denied', async () => {
    const user = crypto.randomUUID().replace('-', '');
    const firestore = env.authenticatedContext(user).firestore();
    await Promise.all([
      assertFails(setDoc(doc(firestore, 'preview-channels', 'staging', 'users', user), {
        state: { vehicle: 'v' },
      })),
      assertFails(addDoc(collection(firestore, 'preview-channels', 'pr-x', 'vehicles'), {
        classes: ['Business'],
        name: 'カローラ',
        permissions: { read: [user], write: [user] },
      })),
    ]);
  });
});
