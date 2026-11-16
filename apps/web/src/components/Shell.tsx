import { Link, NavLink, Outlet } from 'react-router';

export function Shell() {
  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <div className="shell">
        <header className="banner">
          <nav aria-label="Primary">
            <NavLink to="/avatars">Avatars</NavLink>
            <NavLink to="/chat">Chat</NavLink>
          </nav>
        </header>
        <main id="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </>
  );
}

export function BackLink() {
  return (
    <p className="back">
      <Link to="/avatars">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="chevron">
          <path
            d="M10.5 2.5 5 8l5.5 5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          />
        </svg>
        Avatars
      </Link>
    </p>
  );
}
