import { createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, addDoc, Timestamp, collection } from 'firebase/firestore';

function signIn() {
  // initializeApp 後に評価されるよう、Auth は呼び出し時に取得する
  const auth = getAuth();
  signInWithEmailAndPassword(auth, 'abc@example.com', 'abcd1234').catch(async ({ code }) => {
    if (code !== 'auth/user-not-found') return;
    const { user } = await createUserWithEmailAndPassword(auth, 'abc@example.com', 'abcd1234');
    const now = Date.now();
    setDoc(doc(getFirestore(), 'trips', user.uid), {
      data: [{
        class: 'Private',
        odo: 140,
        timestamp: Timestamp.fromMillis(now - 10 * 5.92 * 24 * 3600 * 1000),
      }, {
        class: 'Business',
        odo: 199,
        timestamp: Timestamp.fromMillis(now - 10 * 5.03 * 24 * 3600 * 1000),
      }, {
        class: 'Business',
        odo: 323,
        timestamp: Timestamp.fromMillis(now - 5 * 4.05 * 24 * 3600 * 1000),
      }, {
        class: 'Private',
        odo: 342,
        timestamp: Timestamp.fromMillis(now - 5 * 2.8 * 24 * 3600 * 1000),
      }, {
        class: 'Private',
        odo: 369,
        timestamp: Timestamp.fromMillis(now - 3 * 2.1 * 24 * 3600 * 1000),
      }, {
        class: 'Business',
        odo: 369.9,
        timestamp: Timestamp.fromMillis(now - 3 * 0.9 * 24 * 3600 * 1000),
      }, {
        class: 'Private',
        odo: 370,
        timestamp: Timestamp.fromMillis(now),
      }],
    });
    addDoc(collection(getFirestore(), 'vehicles'), {
      name: '他人のテスト車両',
      classes: ['太郎', '花子'],
      permissions: {
        read: [user.uid],
        write: [user.uid],
      },
    });
  });
}

export default function SignInWithTestEmailPassword() {
  return (
    <button onClick={signIn}>
      Sign in
    </button>
  );
}
