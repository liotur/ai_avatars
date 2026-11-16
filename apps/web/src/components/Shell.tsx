import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet } from 'react-router';
import { ASSISTANT_STATUS_KEY, fetchAssistantStatus } from '../api/assistant';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';

export function Shell() {
  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">Avatars</span>
          </Link>
          <nav aria-label="Primary" className="nav">
            <NavLink to="/chat">
              <Icon name="message" />
              Chat
            </NavLink>
            <NavLink to="/avatars">
              <Icon name="grid" />
              Library
            </NavLink>
            <NavLink to="/how-it-works">
              <Icon name="flow" />
              How it works
            </NavLink>
          </nav>
          <div className="topbar-tools">
            <AssistantChip />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="content" tabIndex={-1} className="page">
        <Outlet />
      </main>
    </>
  );
}

/** Says at a glance whether chat can answer, and with which model. */
function AssistantChip() {
  const status = useQuery({
    queryKey: ASSISTANT_STATUS_KEY,
    queryFn: fetchAssistantStatus,
    staleTime: 30_000,
  });

  if (status.isPending) return null;
  if (status.isError) {
    return (
      <span className="chip chip-off">
        <span className="dot" aria-hidden="true" />
        <span className="chip-text">Assistant offline</span>
      </span>
    );
  }
  if (!status.data.ready) {
    return (
      <Link className="chip chip-warn" to="/chat">
        <span className="dot" aria-hidden="true" />
        <span className="chip-text">Assistant needs setup</span>
      </Link>
    );
  }
  return (
    <span className="chip chip-ok">
      <span className="dot" aria-hidden="true" />
      <span className="chip-text">
        <span className="visually-hidden">Assistant model: </span>
        {status.data.model ?? 'Assistant ready'}
      </span>
    </span>
  );
}

export function BackLink() {
  return (
    <p className="back">
      <Link to="/avatars">
        <Icon name="arrow-left" />
        Library
      </Link>
    </p>
  );
}
