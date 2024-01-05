import { Timestamp, addDoc, collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteField } from "@firebase/firestore";
import { RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";

function offsetHours(date: Date, hours: number): Date {
  const t = new Date(date);
  t.setHours(t.getHours() + hours);
  return t;
}

describe('Firestore security rules', () => {
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
      ({ id: vid } = await addDoc(collection(firestore, 'vehicles'), {
        permissions: {
          read: [uid, readOnlyUid],
          write: [uid, writeOnlyUid],
        },
        classes: ['Business', 'Private'],
      }));
      ({ id: tid } = await addDoc(collection(firestore, 'vehicles', vid, 'trips'), {
        timestamp: Timestamp.fromDate(offsetHours(new Date(), -2)),
        odo: 2.3,
        class: 'Business',
      }));
      await setDoc(doc(firestore, 'users', uid), {
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
      await assertSucceeds(setDoc(doc(env.authenticatedContext(user).firestore(), 'users', user), {
        state: { vehicle: vid },
      }));
    });
    test('an user cannot create a document with incorrect fields', async () => {
      const user = crypto.randomUUID().replace('-', '');
      const firestore = env.authenticatedContext(user).firestore();
      await Promise.all([
        assertFails(setDoc(doc(firestore, 'users', user), {
          state: { vehicle: 0 },
        })),
        assertFails(setDoc(doc(firestore, 'users', user), {
          state: { incorrectKey: vid },
        })),
        assertFails(setDoc(doc(firestore, 'users', user), {
          state: {},
        })),
        assertFails(setDoc(doc(firestore, 'users', user), {
          incorrectKey: { vehicle: vid },
        })),
        assertFails(setDoc(doc(firestore, 'users', user), {
          incorrectKey: 'some',
        })),
        assertFails(setDoc(doc(firestore, 'users', user), {})),
      ]);
    });
    test('an user cannot create other user\'s document', async () => {
      await assertFails(addDoc(collection(env.authenticatedContext(uid).firestore(), 'users'), {
        state: { vehicle: vid },
      }));
    });
    test('an unauthenticated user cannot create a document', async () => {
      await assertFails(addDoc(collection(env.unauthenticatedContext().firestore(), 'users'), {
        state: { vehicle: vid },
      }));
    });
    test('an user can update state.vehicle field', async () => {
      const { id: vehicle } = await addDoc(collection(env.authenticatedContext(uid).firestore(), 'vehicles'), {
        classes: ['S'],
        permissions: {
          read: [uid],
          write: [uid],
        },
      });
      await assertSucceeds(updateDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid), {
        state: { vehicle },
      }));
      await assertSucceeds(updateDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid), {
        'state.vehicle': vid,
      }));
    });
    test('an user cannot update with incorrect values', async () => {
      await Promise.all([
        assertFails(updateDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid), {
          state: { vehicle: 0 },
        })),
        assertFails(updateDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid), {
          state: { unapproved: vid },
        })),
        assertFails(updateDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid), {
          'state.vehicle': 0,
        })),
        assertFails(updateDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid), {
          'state.unapproved': vid,
        })),
        assertFails(updateDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid), {
          unapproved: { vehicle: vid },
        })),
        assertFails(updateDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid), {
          'state.vehicle': deleteField(),
        })),
      ]);
    });
    test('an user cannot update other user\'s document', async () => {
      const user = crypto.randomUUID().replace('-', '');
      await Promise.all([
        assertFails(updateDoc(doc(env.authenticatedContext(user).firestore(), 'users', uid), {
          state: { vehicle: vid },
        })),
        assertFails(updateDoc(doc(env.authenticatedContext(user).firestore(), 'users', uid), {
         'state.vehicle': vid,
        })),
      ]);
    });
    test('an unauthenticated user cannot update a document', async () => {
      await Promise.all([
        assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(), 'users', uid), {
          state: { vehicle: vid },
        })),
        assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(), 'users', uid), {
         'state.vehicle': vid,
        })),
      ]);
    });
  });

  describe('in vehicles collection', () => {
    test('new vehicle with correct fields should be accepted', async () => {
      const user = crypto.randomUUID().replace('-', '');
      await Promise.all([
        assertSucceeds(addDoc(collection(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          permissions: {
            write: [user],
            read: [user, crypto.randomUUID().replace('-', '')],
          },
        })),
        assertSucceeds(addDoc(collection(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          permissions: {
            read: [user],
          },
        })),
        assertSucceeds(addDoc(collection(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          permissions: {
            write: [user],
          },
        })),
      ]);
    });
    test('new vehicle without correct fields should be denied', async () => {
      const user = crypto.randomUUID().replace('-', '');
      await Promise.all([
        assertFails(addDoc(collection(env.authenticatedContext(user).firestore(), 'vehicles'), {
          permissions: {
            write: [user],
            read: [user],
          },
        })),
        assertFails(addDoc(collection(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: 'ClassString',
          permissions: {
            write: [user],
            read: [user],
          },
        })),
        assertFails(addDoc(collection(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
        })),
        assertFails(addDoc(collection(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          permissions: {
            write: 'uid',
            read: [user],
          },
        })),
        assertFails(addDoc(collection(env.authenticatedContext(user).firestore(), 'vehicles'), {
          classes: ['Case1', 'Case2', 'Case3'],
          permissions: {
            write: [user],
            read: 'uid',
          },
        })),
      ]);
    });
    test('new vehicle by an unauthenticated user should be denied', async () => {
      await assertFails(addDoc(collection(env.unauthenticatedContext().firestore(), 'vehicles'), {
        classes: ['Class1', 'Class2', 'Class3'],
        permissions: {
          write: [crypto.randomUUID().replace('-', '')],
          read: [crypto.randomUUID().replace('-', '')],
        },
      }));
    });
    test('an user can list readable vehicles', async () => {
      await Promise.all([
        assertSucceeds(getDocs(query(collection(env.authenticatedContext(uid).firestore(), 'vehicles'), where('permissions.read', 'array-contains', uid)))),
        assertSucceeds(getDocs(query(collection(env.authenticatedContext(readOnlyUid).firestore(), 'vehicles'), where('permissions.read', 'array-contains', readOnlyUid)))),
      ]);
    });
    test('an user cannot list unreadable vehicles', async () => {
      await Promise.all([
        assertFails(getDocs(collection(env.authenticatedContext(uid).firestore(), 'vehicles'))),
        assertFails(getDocs(query(collection(env.authenticatedContext(writeOnlyUid).firestore(), 'vehicles'), where('permissions.write', 'array-contains', writeOnlyUid)))),
      ]);
    });
    test('an unauthenticated user cannot list vehicles', async () => {
      await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'vehicles')));
    });

    describe('in trips collection', () => {
      test('new trip by a permitted user should be accepted', async () => {
        await Promise.all([
          assertSucceeds(addDoc(collection(env.authenticatedContext(uid).firestore(), 'vehicles', vid, 'trips'), {
            timestamp: Timestamp.fromDate(new Date()),
            odo: 12.3,
            class: 'Business',
          })),
          assertSucceeds(addDoc(collection(env.authenticatedContext(writeOnlyUid).firestore(), 'vehicles', vid, 'trips'), {
            timestamp: Timestamp.fromDate(offsetHours(new Date(), 1)),
            odo: 45.6,
            class: 'Private',
          })),
        ]);
      });
      test('new trip with incorrect class should be denied', async () => {
        await Promise.all([
          assertFails(addDoc(collection(env.authenticatedContext(uid).firestore(), 'vehicles', vid, 'trips'), {
            timestamp: Timestamp.fromDate(offsetHours(new Date(), -1)),
            odo: 6.4,
            class: 'NotSpecified',
          })),
          assertFails(addDoc(collection(env.authenticatedContext(uid).firestore(), 'vehicles', vid, 'trips'), {
            timestamp: Timestamp.fromDate(offsetHours(new Date(), -1)),
            odo: 6.3,
          })),
        ]);
      });
      test('new trip by a read only user should be denied', async () => {
        await assertFails(addDoc(collection(env.authenticatedContext(readOnlyUid).firestore(), 'vehicles', vid, 'trips'), {
          timestamp: Timestamp.fromDate(new Date()),
          odo: 12.3,
          class: 'Business',
        }));
      });
      test('new trip by an unauthenticated user should be denied', async () => {
        await assertFails(addDoc(collection(env.unauthenticatedContext().firestore(), 'vehicles', vid, 'trips'), {
          timestamp: Timestamp.fromDate(new Date()),
          odo: 12.3,
          class: 'Business',
        }));
      });
      test('a permitted user can get a trip', async () => {
        await Promise.all([
          assertSucceeds(getDoc(doc(env.authenticatedContext(uid).firestore(), 'vehicles', vid, 'trips', tid))),
          assertSucceeds(getDoc(doc(env.authenticatedContext(readOnlyUid).firestore(), 'vehicles', vid, 'trips', tid))),
        ]);
      });
      test('an unauthenticated user cannot get a trip', async () => {
        await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'vehicles', vid, 'trips', tid)));
      });
      test('a write only user cannot get a trip', async () => {
        await assertFails(getDoc(doc(env.authenticatedContext(writeOnlyUid).firestore(), 'vehicles', vid, 'trips', tid)));
      });
      test('a permitted user can list trips', async () => {
        await Promise.all([
          assertSucceeds(getDocs(collection(env.authenticatedContext(uid).firestore(), 'vehicles', vid, 'trips'))),
          assertSucceeds(getDocs(collection(env.authenticatedContext(readOnlyUid).firestore(), 'vehicles', vid, 'trips'))),
        ]);
      });
      test('an unauthenticated user cannot list trips', async () => {
        await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'vehicles', vid, 'trips')));
      });
      test('a write only user cannot get a trip', async () => {
        await assertFails(getDocs(collection(env.authenticatedContext(writeOnlyUid).firestore(), 'vehicles', vid, 'trips')));
      });
    });
  });
});
