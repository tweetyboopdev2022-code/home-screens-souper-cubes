import React from 'react';
import type { PluginComponentProps } from './hs-plugin';
import { hostFrameStyle } from './host-style';
import { Icon, I } from './icons';
import { parseMeal, formatMeal, tidy } from './logic';

const PLUGIN_ID = 'souper-cubes';
const API = 'https://api.todoist.com/api/v1';
const AUTH = { header: { Authorization: 'Bearer {{todoist_token}}' } };
const sdk = () => (window as any).__HS_SDK__;

async function call(url: string, method = 'GET', body?: unknown) {
  const res: Response = await sdk().pluginFetch(PLUGIN_ID, {
    url, method, cacheTtlMs: 0, secretInjections: AUTH,
    ...(body ? { payload: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

type Meal = { id: string; name: string; count: number };
const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  ['é', 'è', 'à', 'ç', "'", '-', '&'],
];
const SNOW = ['M2 12h20', 'M12 2v20', 'm20 16-4-4 4-4', 'm4 8 4 4-4 4', 'm16 4-4 4-4-4', 'm8 20 4-4 4 4'];

export default function SouperCubes({ config, style }: PluginComponentProps) {
  const projectName = String(config.projectName || 'Souper Cubes');
  const title = String(config.title || 'Souper Cubes');
  const accent = String(config.accentColor || '#0891b2');
  const lowAt = Number(config.lowAt ?? 1);
  const ink = (a: number) => `color-mix(in srgb, ${style.textColor || 'currentColor'} ${Math.round(a * 100)}%, transparent)`;
  const bg = style.backgroundColor && style.backgroundColor !== 'transparent' ? String(style.backgroundColor) : '#fdfcf9';

  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [meals, setMeals] = React.useState<Meal[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ text: string; undo?: () => void } | null>(null);
  const [typing, setTyping] = React.useState(false);
  const [text, setText] = React.useState('');
  const [shift, setShift] = React.useState(true);
  const [qty, setQty] = React.useState(4);
  const pending = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const load = React.useCallback(async () => {
    try {
      let pid = projectId;
      if (!pid) {
        const pj = await call(`${API}/projects?limit=200`);
        let p = (pj.results ?? pj).find((x: any) => String(x.name).toLowerCase() === projectName.toLowerCase());
        if (!p) p = await call(`${API}/projects`, 'POST', { name: projectName, color: 'sky_blue' });
        pid = String(p.id); setProjectId(pid);
      }
      if (pending.current.size) return; // don't overwrite taps that haven't been saved yet
      const tj = await call(`${API}/tasks?project_id=${pid}&limit=200`);
      setMeals((tj.results ?? tj).map((t: any) => ({ id: String(t.id), ...parseMeal(String(t.content)) })));
      setError(null);
    } catch (e) {
      setError(/HTTP (401|403|500)/.test(String((e as Error).message)) ? 'Add your Todoist API token in Plugins → souper-cubes.' : 'Can’t reach Todoist right now.');
    }
  }, [projectId, projectName]);
  React.useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  React.useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 4000); return () => clearTimeout(id); }, [toast]);

  // save a meal's count after taps settle (so 3 quick taps = 1 write)
  const save = (m: Meal) => {
    const old = pending.current.get(m.id); if (old) clearTimeout(old);
    pending.current.set(m.id, setTimeout(async () => {
      try { await call(`${API}/tasks/${m.id}`, 'POST', { content: formatMeal(m.name, m.count) }); }
      catch { setToast({ text: `Couldn’t save ${m.name}` }); }
      finally { pending.current.delete(m.id); }
    }, 900));
  };
  const setCount = (id: string, delta: number) => setMeals((list) => (list ?? []).map((m) => {
    if (m.id !== id) return m;
    const n = { ...m, count: Math.max(0, m.count + delta) }; save(n); return n;
  }));
  const take = (m: Meal) => {
    if (m.count <= 0) return;
    setCount(m.id, -1);
    setToast({ text: `Took 1 ${m.name} · ${m.count - 1} left`, undo: () => setCount(m.id, +1) });
  };
  const remove = async (m: Meal) => {
    setMeals((l) => (l ?? []).filter((x) => x.id !== m.id));
    try { await call(`${API}/tasks/${m.id}`, 'DELETE'); } catch { load(); }
  };
  const add = async (raw: string, n: number) => {
    const name = tidy(raw); if (!name || !projectId) return;
    const existing = (meals ?? []).find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (existing) { setCount(existing.id, n); setToast({ text: `${name}: +${n}` }); return; }
    const tmp: Meal = { id: `tmp-${Date.now()}`, name, count: n };
    setMeals((l) => [...(l ?? []), tmp]);
    try {
      const t = await call(`${API}/tasks`, 'POST', { content: formatMeal(name, n), project_id: projectId });
      setMeals((l) => (l ?? []).map((m) => (m.id === tmp.id ? { ...m, id: String(t.id) } : m)));
    } catch { setMeals((l) => (l ?? []).filter((m) => m.id !== tmp.id)); setToast({ text: `Couldn’t add ${name}` }); }
  };

  const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    appearance: 'none', border: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', background: ink(0.06), borderRadius: '0.5em', ...extra,
  });
  const stocked = (meals ?? []).filter((m) => m.count > 0).sort((a, b) => a.name.localeCompare(b.name));
  const toMake = (meals ?? []).filter((m) => m.count <= 0).sort((a, b) => a.name.localeCompare(b.name));
  const total = stocked.reduce((a, m) => a + m.count, 0);

  return (
    <div style={{ ...hostFrameStyle(style as any), width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
        <Icon d={SNOW} size="1.1em" stroke={2} style={{ color: accent }} />
        <h2 style={{ margin: 0, fontSize: '1.1em', fontWeight: 600 }}>{title}</h2>
        <span style={{ fontSize: '0.65em', opacity: 0.35 }}>{meals ? `${total} cube${total === 1 ? '' : 's'} · ${stocked.length} meal${stocked.length === 1 ? '' : 's'}` : ''}</span>
        <button onClick={() => { setText(''); setShift(true); setQty(4); setTyping(true); }} style={btn({ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3em', padding: '0.35em 0.75em', background: accent, color: '#fff', fontSize: '0.75em', fontWeight: 600, borderRadius: '999px' })}>
          <Icon d={I.plus} size="1.1em" stroke={2.5} /> Add meal
        </button>
      </div>
      <div style={{ height: 1, background: ink(0.08), margin: '0.6em 0 0.7em' }} />

      {error ? <div style={{ margin: 'auto', fontSize: '0.8em', opacity: 0.6 }}>{error}</div> : !meals ? <div style={{ margin: 'auto', opacity: 0.4, fontSize: '0.8em' }}>Loading…</div> : (
        <>
          {stocked.length === 0 && <div style={{ margin: '1em auto', opacity: 0.45, fontSize: '0.8em' }}>Freezer’s empty — time to batch cook!</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8.5em, 1fr))', gap: '0.55em', alignContent: 'start', overflow: 'hidden', flex: '0 1 auto', minHeight: 0 }}>
            {stocked.map((m) => {
              const low = m.count <= lowAt;
              return (
                <div key={m.id} style={{ position: 'relative' }}>
                  <button onClick={() => take(m)} aria-label={`Take one ${m.name}`}
                    style={btn({ width: '100%', textAlign: 'left', padding: '0.6em 0.7em', borderRadius: '0.8em', display: 'flex', flexDirection: 'column', gap: '0.15em',
                      background: `color-mix(in srgb, ${low ? '#f59e0b' : accent} ${low ? 16 : 10}%, transparent)`, opacity: m.id.startsWith('tmp-') ? 0.5 : 1 })}>
                    <span style={{ fontSize: '2em', fontWeight: 300, lineHeight: 1, color: low ? '#d97706' : accent }}>{m.count}</span>
                    <span style={{ fontSize: '0.8em', fontWeight: 500, lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', paddingRight: '1.4em' } as React.CSSProperties}>{m.name}</span>
                    {low && <span style={{ fontSize: '0.55em', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#d97706' }}>Running low</span>}
                  </button>
                  <button onClick={() => setCount(m.id, +1)} aria-label={`Add a cube of ${m.name}`}
                    style={btn({ position: 'absolute', top: '0.45em', right: '0.45em', width: '1.6em', height: '1.6em', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, boxShadow: `0 0 0 1px ${ink(0.1)}` })}>
                    <Icon d={I.plus} size="0.8em" stroke={2.5} />
                  </button>
                </div>
              );
            })}
          </div>

          {toMake.length > 0 && (
            <div style={{ marginTop: 'auto', paddingTop: '0.7em', borderTop: `1px solid ${ink(0.08)}`, display: 'flex', flexDirection: 'column', gap: '0.4em' }}>
              <div style={{ fontSize: '0.6em', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.6 }}>To batch make</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35em' }}>
                {toMake.map((m) => (
                  <span key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2em', padding: '0.2em 0.25em 0.2em 0.7em', borderRadius: '999px', background: ink(0.06), fontSize: '0.75em', fontWeight: 500 }}>
                    {m.name}
                    <button onClick={() => { setText(m.name); setQty(4); setShift(false); setTyping(true); }} aria-label={`Made ${m.name}`} style={btn({ padding: '0.2em 0.5em', borderRadius: '999px', background: accent, color: '#fff', fontSize: '0.85em', fontWeight: 600 })}>Made</button>
                    <button onClick={() => remove(m)} aria-label={`Remove ${m.name}`} style={btn({ background: 'transparent', padding: '0.2em', opacity: 0.4, display: 'flex' })}><Icon d={I.x} size="0.9em" /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {toast && !typing && (
        <div style={{ position: 'absolute', left: '50%', bottom: '1em', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '0.7em', padding: '0.45em 0.6em 0.45em 1em', borderRadius: '999px', background: style.textColor || '#1c1917', color: bg, fontSize: '0.7em', fontWeight: 500, whiteSpace: 'nowrap', zIndex: 3 }}>
          {toast.text}
          {toast.undo && <button onClick={() => { toast.undo!(); setToast(null); }} style={btn({ background: 'transparent', color: accent, fontWeight: 700, padding: '0.1em 0.4em' })}>UNDO</button>}
        </div>
      )}

      {typing && (
        <div style={{ position: 'absolute', inset: 0, background: bg, borderRadius: 'inherit', padding: 'inherit', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '0.5em', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
            <h2 style={{ margin: 0, fontSize: '1.1em', fontWeight: 600 }}>Add to the freezer</h2>
            <button onClick={() => setTyping(false)} style={btn({ marginLeft: 'auto', padding: '0.3em', display: 'flex' })} aria-label="Close"><Icon d={I.x} size="1em" /></button>
          </div>
          <div style={{ display: 'flex', gap: '0.5em', alignItems: 'stretch' }}>
            <div style={{ flex: 1, minHeight: '2.2em', display: 'flex', alignItems: 'center', padding: '0 0.7em', borderRadius: '0.5em', border: `0.08em solid ${ink(0.2)}`, fontWeight: 500 }}>
              {text || <span style={{ opacity: 0.35 }}>Meal name…</span>}<span style={{ width: 2, height: '1.1em', background: accent, marginLeft: 2 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3em' }}>
              <button onClick={() => setQty((q) => Math.max(0, q - 1))} style={btn({ width: '2.2em', height: '2.2em', fontSize: '1em', fontWeight: 600 })} aria-label="Fewer">−</button>
              <div style={{ minWidth: '3.6em', textAlign: 'center', lineHeight: 1.1 }}><div style={{ fontSize: '1.3em', fontWeight: 600 }}>{qty}</div><div style={{ fontSize: '0.55em', opacity: 0.5 }}>cubes</div></div>
              <button onClick={() => setQty((q) => q + 1)} style={btn({ width: '2.2em', height: '2.2em', fontSize: '1em', fontWeight: 600 })} aria-label="More">+</button>
            </div>
          </div>
          {(meals ?? []).length > 0 && (
            <div style={{ display: 'flex', gap: '0.35em', flexWrap: 'wrap', minHeight: '1.9em' }}>
              {(meals ?? []).filter((m) => !text || m.name.toLowerCase().startsWith(text.toLowerCase())).slice(0, 6).map((m) => (
                <button key={m.id} onClick={() => { setText(m.name); setShift(false); }} style={btn({ padding: '0.3em 0.7em', fontSize: '0.75em', fontWeight: 500, borderRadius: '999px' })}>{m.name}</button>
              ))}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
            {ROWS.map((row, ri) => (
              <div key={ri} style={{ flex: 1, maxHeight: '3.2em', display: 'flex', gap: '0.3em', justifyContent: 'center' }}>
                {ri === 2 && <button onClick={() => setShift((s) => !s)} style={btn({ flex: 1.5, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: shift ? ink(0.18) : ink(0.06) })} aria-label="Shift"><Icon d={I.shift} size="0.9em" /></button>}
                {row.map((k) => (
                  <button key={k} onClick={() => { setText((t) => t + (shift ? k.toUpperCase() : k)); setShift(false); }} style={btn({ flex: 1, height: '100%', fontSize: '0.85em', fontWeight: 500, maxWidth: '3em' })}>{shift ? k.toUpperCase() : k}</button>
                ))}
                {ri === 2 && <button onClick={() => setText((t) => t.slice(0, -1))} style={btn({ flex: 1.5, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' })} aria-label="Delete"><Icon d={I.back} size="0.9em" /></button>}
              </div>
            ))}
            <div style={{ flex: 1, maxHeight: '3.2em', display: 'flex', gap: '0.3em' }}>
              <button onClick={() => setText((t) => (t && !t.endsWith(' ') ? t + ' ' : t))} style={btn({ flex: 3, height: '100%', fontSize: '0.75em', opacity: 0.8 })}>space</button>
              <button disabled={!text.trim()} onClick={() => { add(text, qty); setText(''); setShift(true); setTyping(false); }}
                style={btn({ flex: 2.5, height: '100%', fontSize: '0.8em', fontWeight: 600, background: text.trim() ? accent : ink(0.1), color: text.trim() ? '#fff' : 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3em' })}>
                <Icon d={I.plus} size="1em" stroke={2.5} /> {qty > 0 ? `Add ${qty}` : 'Add to “batch make”'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
