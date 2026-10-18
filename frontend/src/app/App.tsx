import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";

import { ApiError, api } from "../lib/api";
import type { Health, Profile, SystemInfo } from "../types/api";

type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string; requestId?: string; failedAt: number }
  | { status: "success"; value: T };

type Reload = () => Promise<void>;

const loadProfiles = async () => (await api.profiles()).profiles;

/** Load one API resource and expose a reload that ignores calls while a request is in flight. */
function useResource<T>(fetcher: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const value = await fetcher();
      if (mounted.current) setState({ status: "success", value });
    } catch (error) {
      if (mounted.current) setState(toErrorState(error));
    } finally {
      inFlight.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, [fetcher]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  return { state, refreshing, reload };
}

function useBackend() {
  const health = useResource<Health>(api.health);
  const system = useResource<SystemInfo>(api.systemInfo);
  const profiles = useResource<Profile[]>(loadProfiles);
  const reloadHealth = health.reload;
  const reloadSystem = system.reload;
  const reloadProfiles = profiles.reload;
  const reloadAll = useCallback(async () => {
    await Promise.all([reloadHealth(), reloadSystem(), reloadProfiles()]);
  }, [reloadHealth, reloadSystem, reloadProfiles]);

  return {
    health: health.state,
    system: system.state,
    profiles: profiles.state,
    refreshing: {
      health: health.refreshing,
      system: system.refreshing,
      profiles: profiles.refreshing,
      any: health.refreshing || system.refreshing || profiles.refreshing,
    },
    reload: { health: reloadHealth, system: reloadSystem, profiles: reloadProfiles, all: reloadAll },
  };
}

function toErrorState(error: unknown): Extract<LoadState<never>, { status: "error" }> {
  return {
    status: "error",
    message: error instanceof Error ? error.message : "An unexpected API error occurred.",
    requestId: error instanceof ApiError ? error.requestId : undefined,
    failedAt: Date.now(),
  };
}

function App() {
  const backend = useBackend();
  const profileCount =
    backend.profiles.status === "success" ? backend.profiles.value.length : undefined;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="BackInTime home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>
            <strong>BackInTime</strong>
            <small>Snapshot manager</small>
          </span>
        </a>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>
            <span className="nav-icon" aria-hidden="true">⌂</span>
            Overview
          </NavLink>
          <NavLink to="/profiles" className={({ isActive }) => navClass(isActive)}>
            <span className="nav-icon" aria-hidden="true">▤</span>
            Profiles
            {profileCount !== undefined && <span className="nav-count">{profileCount}</span>}
          </NavLink>
          <span className="nav-item disabled" aria-disabled="true">
            <span className="nav-icon" aria-hidden="true">◷</span>
            Snapshots
            <span className="soon-label">Soon</span>
          </span>
          <span className="nav-item disabled" aria-disabled="true">
            <span className="nav-icon" aria-hidden="true">⚙</span>
            Settings
          </span>
        </nav>
        <div className="sidebar-foot">
          <span className={`status-dot ${backend.health.status === "success" ? "online" : ""}`} />
          <span>Local service</span>
          <span className="service-state">
            {backend.health.status === "success"
              ? "Connected"
              : backend.health.status === "loading"
                ? "Connecting"
                : "Offline"}
          </span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">BackInTime <span>/</span> Local workspace</div>
          <div className="topbar-right">
            <span className="local-badge"><span aria-hidden="true">⌑</span> This device</span>
            <span className="avatar" aria-label="Local user">L</span>
          </div>
        </header>
        <Routes>
          <Route
            path="/"
            element={
              <Dashboard
                health={backend.health}
                system={backend.system}
                profiles={backend.profiles}
                refreshing={backend.refreshing}
                reload={backend.reload}
              />
            }
          />
          <Route
            path="/profiles"
            element={
              <Profiles
                state={backend.profiles}
                refreshing={backend.refreshing.profiles}
                onReload={backend.reload.profiles}
              />
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <footer className="footer-note">
          <span>Independent open-source project</span>
          <span>Local data stays on this device</span>
        </footer>
      </main>
    </div>
  );
}

function navClass(isActive: boolean) {
  return `nav-item${isActive ? " active" : ""}`;
}

type Backend = ReturnType<typeof useBackend>;

function Dashboard({
  health,
  system,
  profiles,
  refreshing,
  reload,
}: {
  health: LoadState<Health>;
  system: LoadState<SystemInfo>;
  profiles: LoadState<Profile[]>;
  refreshing: Backend["refreshing"];
  reload: Backend["reload"];
}) {
  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR BACKUP WORKSPACE</p>
          <h1>Overview</h1>
          <p className="subtitle">A clear view of your backup setup and local service.</p>
        </div>
        <RefreshButton
          label="Refresh overview"
          refreshing={refreshing.any}
          onRefresh={reload.all}
        />
      </div>

      {health.status === "error" && (
        <ErrorBanner subject="service status" state={health} retrying={refreshing.health} onRetry={reload.health} />
      )}
      {profiles.status === "error" && (
        <ErrorBanner subject="profiles" state={profiles} retrying={refreshing.profiles} onRetry={reload.profiles} />
      )}

      <section className="service-banner" aria-label="Backup service status">
        <div className={`service-symbol ${health.status === "success" ? "ready" : ""}`}>
          <span aria-hidden="true">{health.status === "success" ? "✓" : "!"}</span>
        </div>
        <div className="service-copy">
          <span className="eyebrow">LOCAL BACKUP SERVICE</span>
          <h2>
            {health.status === "loading"
              ? "Checking local service…"
              : health.status === "success"
                ? "Service is ready"
                : "Service is unavailable"}
          </h2>
          <p>
            {health.status === "success"
              ? "The local API is reachable. Backup operations are not available yet."
              : health.status === "error"
                ? "Start the local API, then select Retry to reconnect."
                : "Connecting to the local API."}
          </p>
        </div>
        <div className="service-meta">
          {health.status === "success" ? (
            <>
              <span className="live-indicator" />
              API v{health.value.version}
            </>
          ) : (
            <span className="muted">Loopback only</span>
          )}
        </div>
      </section>

      <div className="stats-grid">
        <StatCard
          label="BACKUP PROFILES"
          value={
            profiles.status === "success"
              ? String(profiles.value.length).padStart(2, "0")
              : profiles.status === "loading"
                ? "—"
                : "!"
          }
          note={profiles.status === "success" ? "Configured on this device" : "Profile data unavailable"}
          icon="▤"
          accent="blue"
        />
        <StatCard label="SNAPSHOTS" value="—" note="Available after backup engine setup" icon="◷" accent="violet" />
        <StatCard label="LAST BACKUP" value="—" note="No backup operations are available yet" icon="↻" accent="green" />
      </div>

      <div className="content-grid">
        <section className="panel profile-panel">
          <div className="panel-heading">
            <div>
              <h2>Backup profiles</h2>
              <p>Configured source and destination pairs</p>
            </div>
            <NavLink className="text-link" to="/profiles">View profiles <span aria-hidden="true">→</span></NavLink>
          </div>
          <ProfileList state={profiles} compact />
        </section>

        <section className="panel readiness-panel">
          <div className="panel-heading">
            <div>
              <h2>System readiness</h2>
              <p>Runtime checks from this device</p>
            </div>
            <span className="check-icon" aria-hidden="true">✓</span>
          </div>
          {system.status === "loading" ? (
            <p className="empty-copy">Checking system…</p>
          ) : system.status === "error" ? (
            <ErrorBanner subject="system information" state={system} retrying={refreshing.system} onRetry={reload.system} />
          ) : (
            <dl className="readiness-list">
              <div><dt>Operating system</dt><dd>{system.value.platform}</dd></div>
              <div><dt>Python runtime</dt><dd>{system.value.python_version}</dd></div>
              <div>
                <dt>rsync</dt>
                <dd className={system.value.rsync_available ? "positive-text" : "warning-text"}>
                  <span className="tiny-status" />
                  {system.value.rsync_available ? "Available" : "Not installed"}
                </dd>
              </div>
              <div><dt>Backup engine</dt><dd className="muted">Not implemented</dd></div>
            </dl>
          )}
        </section>
      </div>

      <div className="notice">
        <span className="notice-icon" aria-hidden="true">i</span>
        <p>
          <strong>Early development.</strong> Profile configuration and system checks are
          available. Backup, restore, snapshot browsing, and retention are still under
          development. No backup has been run by this application.
        </p>
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  note,
  icon,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  icon: string;
  accent: string;
}) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${accent}`} aria-hidden="true">{icon}</div>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-note">{note}</span>
    </article>
  );
}

function Profiles({
  state,
  refreshing,
  onReload,
}: {
  state: LoadState<Profile[]>;
  refreshing: boolean;
  onReload: Reload;
}) {
  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>Profiles</h1>
          <p className="subtitle">Source and destination settings loaded from the local configuration.</p>
        </div>
        <RefreshButton label="Refresh profiles" refreshing={refreshing} onRefresh={onReload} />
      </div>
      {state.status === "error" ? (
        <ErrorBanner subject="profiles" state={state} retrying={refreshing} onRetry={onReload} />
      ) : (
        <section className="panel full-panel">
          <div className="panel-heading">
            <div>
              <h2>Configured profiles</h2>
              <p>Read-only view · editing is not implemented</p>
            </div>
            {state.status === "success" && <span className="result-count">{state.value.length} total</span>}
          </div>
          <ProfileList state={state} />
        </section>
      )}
      <div className="notice">
        <span className="notice-icon" aria-hidden="true">i</span>
        <p>Profiles can currently be configured by editing the validated local JSON configuration. In-app editing is not available.</p>
      </div>
    </section>
  );
}

function ProfileList({ state, compact = false }: { state: LoadState<Profile[]>; compact?: boolean }) {
  if (state.status === "loading") return <p className="empty-copy">Loading configured profiles…</p>;
  if (state.status === "error") return <p className="empty-copy">Profile information could not be loaded.</p>;
  if (state.value.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true">▤</span>
        <h3>No profiles configured</h3>
        <p>Add a profile to your local configuration to see it here.</p>
      </div>
    );
  }

  const items = compact ? state.value.slice(0, 3) : state.value;
  return (
    <div className="profile-list">
      {items.map((profile) => (
        <article className="profile-row" key={profile.profile_id}>
          <span className="profile-avatar" aria-hidden="true">{profile.name.trim().charAt(0).toUpperCase()}</span>
          <div className="profile-detail">
            <strong>{profile.name}</strong>
            <span>{profile.sources.length} source{profile.sources.length === 1 ? "" : "s"}</span>
          </div>
          <div className="profile-destination">
            <span>DESTINATION</span>
            <code title={profile.target}>{profile.target}</code>
          </div>
          <span className="configured-badge"><span /> Configured</span>
        </article>
      ))}
    </div>
  );
}

function ErrorBanner({
  subject,
  state,
  retrying = false,
  onRetry,
}: {
  subject: string;
  state: Extract<LoadState<unknown>, { status: "error" }>;
  retrying?: boolean;
  onRetry?: Reload;
}) {
  return (
    // Keyed by failure time so a failed retry re-announces the alert.
    <div className="error-banner" role="alert" key={state.failedAt}>
      <span aria-hidden="true">!</span>
      <div className="error-copy">
        <strong>Could not load {subject}</strong>
        <p>{state.message}{state.requestId ? ` Request ID: ${state.requestId}` : ""}</p>
        <p className="error-time">
          Last attempt failed at {new Date(state.failedAt).toLocaleTimeString()}.
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          className="retry-button"
          disabled={retrying}
          aria-busy={retrying}
          aria-label={retrying ? `Retrying ${subject}` : `Retry loading ${subject}`}
          onClick={() => void onRetry()}
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}

function RefreshButton({
  label,
  refreshing,
  onRefresh,
}: {
  label: string;
  refreshing: boolean;
  onRefresh: Reload;
}) {
  return (
    <button
      type="button"
      className="refresh-button"
      disabled={refreshing}
      aria-busy={refreshing}
      onClick={() => void onRefresh()}
    >
      <span className={`refresh-icon${refreshing ? " spinning" : ""}`} aria-hidden="true">↻</span>
      {refreshing ? "Refreshing…" : label}
    </button>
  );
}

function NotFound() {
  return (
    <section className="page-content">
      <div className="page-heading">
        <div><p className="eyebrow">404</p><h1>Page not found</h1><p className="subtitle">This section is not available.</p></div>
      </div>
      <NavLink className="text-link" to="/">Return to overview →</NavLink>
    </section>
  );
}

export default App;
