import SignInWithGoogle from './SignInWithGoogle';
import SignInWithTestEmailPassword from './SignInWithTestEmailPassword';
import SignOut from './SignOut';
import DeleteAccount from './DeleteAccount';

const dev = process.env.PROJECT_ID !== 'records-classificater';
const local = process.env.NODE_ENV !== 'production';

export default function Auth({ currentUser = null }) {
  return (
    <div className="flex gap-2 text-red-700">
      {local && currentUser && <DeleteAccount currentUser={currentUser} />}
      {currentUser ? (
        <SignOut />
      ) : dev ? (
        <SignInWithTestEmailPassword />
      ) : (
        <SignInWithGoogle />
      )}
    </div>
  );
}
