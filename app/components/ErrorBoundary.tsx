import { useEffect } from 'react';
import { useRouteError, isRouteErrorResponse } from 'react-router-dom';

export function ErrorBoundary() {
  const error = useRouteError();
  
  let errorMessage = 'An unexpected error occurred';
  let errorStack: string | undefined;
  let errorDetails: Record<string, unknown> = {};
  
  if (isRouteErrorResponse(error)) {
    errorMessage = error.statusText || error.data?.message || errorMessage;
    if (error.data instanceof Error) {
      errorStack = error.data.stack;
      errorMessage = error.data.message || errorMessage;
      errorDetails = {
        name: error.data.name,
        cause: error.data.cause,
      };
    }
  } else if (error instanceof Error) {
    errorMessage = error.message;
    errorStack = error.stack;
    errorDetails = {
      name: error.name,
      cause: error.cause,
    };
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else {
    try {
      errorMessage = JSON.stringify(error);
    } catch {
      errorMessage = String(error);
    }
  }
  
  console.error('Error Boundary caught error:', {
    error,
    message: errorMessage,
    stack: errorStack,
    details: errorDetails,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: window.location.href,
  });
  
  const isModuleImportError = errorMessage.includes('Failed to fetch dynamically imported module') ||
                              errorMessage.includes('Failed to fetch') ||
                              (error instanceof Error && error.message.includes('Failed to fetch'));

  // Self-heal stale-chunk errors: a tab left open across a deploy tries to lazy-load
  // an old chunk hash the deploy replaced → import fails. Clear caches + reload ONCE to
  // the fresh build. Guarded by a 15s sessionStorage stamp so a genuinely persistent
  // failure shows the real error page instead of reload-looping. `canSelfHeal` is also
  // read at render time to show a calm "updating…" screen instead of the red crash.
  const RELOAD_KEY = 'nexus_chunk_reload_ts';
  const lastReloadAt = Number((typeof sessionStorage !== 'undefined' && sessionStorage.getItem(RELOAD_KEY)) || 0);
  const canSelfHeal = isModuleImportError && (Date.now() - lastReloadAt >= 15000);
  useEffect(() => {
    if (!canSelfHeal) return;
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
    (async () => {
      try {
        if ('caches' in window) { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); }
      } catch { /* best-effort */ }
      // Cache-bust the HTML fetch so a wedged/edge-cached index.html can't be reused —
      // a plain reload can re-serve the same stale document graph.
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('_v', String(Date.now()));
        window.location.replace(u.toString());
      } catch { window.location.reload(); }
    })();
  }, [canSelfHeal]);

  // Stale-chunk error that we're about to auto-recover from → show a calm "updating"
  // screen, not the alarming red error dump. If the reload also fails (guard blocks
  // canSelfHeal on the next mount), we fall through to the full error below.
  if (canSelfHeal) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f11', color: '#a1a1aa', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, fontFamily: 'var(--nx-font-mono), monospace' }}>
        <div style={{ fontSize: 24, color: '#ededf0' }}>◆</div>
        <div style={{ fontSize: 13, letterSpacing: '0.04em', color: '#ededf0' }}>Updating Nexus to the latest version…</div>
        <div style={{ fontSize: 11, color: '#52525b' }}>A new build just shipped — reloading.</div>
      </div>
    );
  }

  // What a person sees when a page throws: what happened in plain words, that nothing moved, and
  // two ways out. The message + stack stay one tap away for a bug report, and every line wraps
  // (the old developer screen printed the whole URL unbroken and scrolled sideways on a phone).
  const report = [
    `Error: ${errorMessage}`,
    `Page: ${window.location.pathname}${window.location.search}`,
    `Time: ${new Date().toISOString()}`,
    errorStack ? `\n${errorStack}` : '',
  ].join('\n');
  const copyReport = () => { try { void navigator.clipboard?.writeText(report); } catch { /* clipboard blocked */ } };
  const btn: React.CSSProperties = {
    minHeight: 40, padding: '0 16px', borderRadius: 8, cursor: 'pointer',
    fontFamily: 'var(--nx-font-ui, sans-serif)', fontSize: 13.5, fontWeight: 600,
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0b', color: '#ededf0', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '24px 16px', boxSizing: 'border-box',
      fontFamily: 'var(--nx-font-ui, sans-serif)',
    }}>
      <div style={{ maxWidth: 520, width: '100%', boxSizing: 'border-box', background: '#141416', border: '1px solid #232327', borderRadius: 10, padding: '24px 20px', overflowWrap: 'anywhere' }}>
        <div aria-hidden style={{ fontSize: 20, color: '#a1a1aa', marginBottom: 10 }}>◆</div>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px', color: '#ededf0' }}>This page hit an error.</h1>
        <p style={{ margin: '0 0 6px', fontSize: 14, lineHeight: 1.55, color: '#a1a1aa' }}>
          A screen error moves no money. Your balance and positions live on Orderly, untouched.
        </p>
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.55, color: '#a1a1aa' }}>
          {isModuleImportError
            ? 'A new version shipped while this tab was open. Reload to get it; if that fails, do a hard refresh (Ctrl/Cmd+Shift+R).'
            : 'Reload usually clears it. If it keeps happening, copy the details and send them to us.'}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" onClick={() => window.location.reload()} style={{ ...btn, background: '#ededf0', color: '#0a0a0b', border: 'none' }}>Reload</button>
          <button type="button" onClick={() => window.location.assign('/')} style={{ ...btn, background: 'none', color: '#ededf0', border: '1px solid #33333a' }}>Go home</button>
          <button type="button" onClick={copyReport} style={{ ...btn, background: 'none', color: '#a1a1aa', border: '1px solid #232327' }}>Copy error details</button>
        </div>
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: 'pointer', color: '#71717a', fontSize: 12.5 }}>Error details</summary>
          <pre style={{
            margin: '8px 0 0', padding: 10, background: '#0a0a0b', borderRadius: 6, maxHeight: 280, overflow: 'auto',
            fontFamily: 'var(--nx-font-mono)', fontSize: 11, lineHeight: 1.5, color: '#a1a1aa',
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          }}>
            {report}{errorDetails && Object.keys(errorDetails).length > 0 ? `\n\n${JSON.stringify(errorDetails, null, 2)}` : ''}
          </pre>
        </details>
      </div>
    </div>
  );
}
