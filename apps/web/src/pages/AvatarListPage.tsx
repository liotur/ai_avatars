import type { Avatar } from '@avatars/contracts/avatar';
import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { fetchAvatars } from '../api/avatars';
import { ProblemError } from '../api/problem';
import { AvatarOrb, hueOf } from '../components/AvatarOrb';
import { Icon } from '../components/Icon';
import { IntensityMeter } from '../components/IntensityMeter';
import { useDocumentTitle } from '../useDocumentTitle';

/** How many "use when" situations a card shows before it says how many more there are. */
const SHOWN_SITUATIONS = 2;

export function AvatarListPage() {
  useDocumentTitle('Avatars');
  const query = useQuery({
    queryKey: ['avatars'],
    queryFn: fetchAvatars,
  });
  const items = query.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Library</p>
          <h1>Avatars</h1>
          <p className="lede">
            Each avatar is a stance the assistant can answer in: a way of seeing a question and a way of speaking.
          </p>
        </div>
        <Link className="button button-primary" to="/avatars/new">
          <Icon name="plus" />
          New avatar
        </Link>
      </div>
      {query.isPending ? (
        <>
          <p className="visually-hidden" role="status">
            Loading avatars.
          </p>
          <ul className="avatar-grid" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <li key={index} className="avatar-card skeleton" />
            ))}
          </ul>
        </>
      ) : null}
      {query.isError ? (
        <div className="notice notice-error">
          <p role="alert">
            {query.error instanceof ProblemError ? query.error.detail : 'The avatar list could not be loaded.'}
          </p>
          <button type="button" className="button button-quiet" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {query.isSuccess && items.length === 0 ? (
        <div className="empty">
          <div className="orb-cluster">
            <AvatarOrb name="Skeptic" size="lg" />
            <AvatarOrb name="Mentor" size="lg" />
            <AvatarOrb name="Future me" size="lg" />
          </div>
          <p className="empty-title">No avatars yet.</p>
          <p className="lede">
            Create one here, or ask a question in chat and the assistant will draft an avatar that fits it.
          </p>
          <div className="empty-actions">
            <Link className="button button-primary" to="/avatars/new">
              Create your first avatar
            </Link>
            <Link className="button button-quiet" to="/chat">
              Ask in chat
            </Link>
          </div>
        </div>
      ) : null}
      {query.isSuccess && items.length > 0 ? (
        <ul className="avatar-grid">
          {items.map((avatar) => (
            <li key={avatar.id}>
              <AvatarCard avatar={avatar} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function AvatarCard({ avatar }: { avatar: Avatar }) {
  const situations = avatar.useWhen.slice(0, SHOWN_SITUATIONS);
  const more = avatar.useWhen.length - situations.length;

  return (
    <article className="avatar-card" style={{ '--orb-h': hueOf(avatar.name) } as CSSProperties}>
      <div className="avatar-card-head">
        <AvatarOrb name={avatar.name} size="lg" />
        <div className="avatar-card-title">
          <h2 className="avatar-name">
            <Link to={`/avatars/${avatar.id}`}>{avatar.name}</Link>
          </h2>
          <span className="avatar-intensity">
            <IntensityMeter intensity={avatar.intensity} />
            {avatar.intensity}
          </span>
        </div>
      </div>
      <p className="avatar-description">{avatar.description}</p>
      {situations.length > 0 ? (
        <ul className="chips" aria-label="Use when">
          {situations.map((situation) => (
            <li key={situation}>{situation}</li>
          ))}
          {more > 0 ? <li>+{more} more</li> : null}
        </ul>
      ) : null}
      <div className="avatar-card-foot">
        {avatar.createdBy === 'assistant' ? (
          <span className="badge badge-accent">
            <Icon name="sparkles" />
            Made by assistant
          </span>
        ) : null}
        <Link className="card-action" to={`/chat?avatar=${avatar.id}`}>
          <Icon name="message" />
          Ask<span className="visually-hidden"> {avatar.name}</span>
        </Link>
      </div>
    </article>
  );
}
