import {
  BarChart3,
  CalendarDays,
  Home,
  ListTodo,
  NotebookPen,
  Orbit,
  Timer,
  UserRound,
  UsersRound,
  LogIn
} from 'lucide-react';

const PAGES = [
  ['Today', Home, '/'],
  ['Tasks', ListTodo, '/tasks'],
  ['Notes', NotebookPen, '/notes'],
  ['Calendar', CalendarDays, '/calendar'],
  ['Focus', Timer, '/focus'],
  ['Groups', UsersRound, '/groups'],
  ['Score', BarChart3, '/score'],
  ['Profile', UserRound, '/profile']
];

export default function WorkspaceNav({
  activeView,
  onNavigate,
  currentUser,
  onGoogleLogin,
  googleReady
}) {
  const links = PAGES.map(([label, Icon, href]) => (
    <a
      key={label}
      href={href}
      className={activeView === label ? 'selected' : ''}
      aria-current={activeView === label ? 'page' : undefined}
      onClick={(event) => {
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          event.button === 0
        ) {
          event.preventDefault();
          onNavigate(label);
        }
      }}
    >
      <Icon size={20} strokeWidth={1.7} />
      <span>{label}</span>
    </a>
  ));
  return (
    <>
      <a className="skip-link" href="#workspace-content">
        Skip to content
      </a>
      <aside className="workspace-sidebar">
        <a
          href="/"
          className="sidebar-brand"
          onClick={(event) => {
            event.preventDefault();
            onNavigate('Today');
          }}
        >
          <Orbit size={34} strokeWidth={1.5} />
          <div>
            <strong>Orbit</strong>
            <span>Your focus, in motion.</span>
          </div>
        </a>
        <nav aria-label="Main navigation">{links}</nav>
        <div className="sidebar-account">
          <button type="button" onClick={() => onNavigate('Profile')}>
            <UserRound size={20} />
            <span>
              {currentUser?.isGuest
                ? 'Guest session'
                : currentUser?.displayName || 'Your account'}
            </span>
          </button>
          {currentUser?.isGuest ? (
            <button
              type="button"
              disabled={!googleReady}
              onClick={onGoogleLogin}
            >
              <LogIn size={18} />
              <span>Connect Google</span>
            </button>
          ) : null}
        </div>
      </aside>
      <nav className="mobile-navigation" aria-label="Mobile navigation">
        {links}
      </nav>
    </>
  );
}
