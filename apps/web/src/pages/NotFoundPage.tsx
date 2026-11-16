import { Link } from 'react-router';
import { useDocumentTitle } from '../useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Page not found');

  return (
    <div className="narrow">
      <div className="empty">
        <h1>Page not found</h1>
        <p className="lede" role="alert">
          There is no page at this address.
        </p>
        <div className="empty-actions">
          <Link className="button button-quiet" to="/avatars">
            Back to avatars
          </Link>
        </div>
      </div>
    </div>
  );
}
