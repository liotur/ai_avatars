import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { fetchAvatars } from '../api/avatars';
import { ProblemError } from '../api/problem';
import { useDocumentTitle } from '../useDocumentTitle';

export function AvatarListPage() {
  useDocumentTitle('Avatars');
  const query = useQuery({
    queryKey: ['avatars'],
    queryFn: fetchAvatars,
  });
  const items = query.data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Avatars</h1>
        <Link className="button button-primary" to="/avatars/new">
          New avatar
        </Link>
      </div>
      {query.isPending ? <p role="status">Loading avatars.</p> : null}
      {query.isError ? (
        <div className="notice">
          <p role="alert">{query.error instanceof ProblemError ? query.error.detail : 'The avatar list could not be loaded.'}</p>
          <button type="button" className="button button-quiet" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {query.isSuccess && items.length === 0 ? <p className="empty">No avatars yet.</p> : null}
      {query.isSuccess && items.length > 0 ? (
        <ul className="avatar-list">
          {items.map((avatar) => (
            <li key={avatar.id}>
              <Link className="avatar-row" to={`/avatars/${avatar.id}`}>
                <span className="avatar-name">{avatar.name}</span>
                <span className="avatar-intensity">{avatar.intensity}</span>
                <p className={avatar.createdBy === 'assistant' ? 'avatar-description' : 'avatar-description wide'}>
                  {avatar.description}
                </p>
                {avatar.createdBy === 'assistant' ? <span className="avatar-by">assistant</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
