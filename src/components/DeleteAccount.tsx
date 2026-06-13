import { User, deleteUser } from 'firebase/auth';

export default function DeleteAccount({ currentUser }: { currentUser: User }) {
  return (
    <button onClick={() => deleteUser(currentUser)}>
      Delete Account
    </button>
  );
}
