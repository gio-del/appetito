import React from 'react';
import { AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

// appetito launch video, 1080×1920 @ 60 fps, ~41 s. Text carries the story (most people watch muted).
// Palette = the tracker's: dark #101112, accent #e5623a → #f2a541.
export const FPS = 60;
const S = (s: number) => Math.round(s * FPS);
// Scene boundaries (seconds).
// A take with a rollback gets the repair scene: work: 12.8, repair: 19.8, owner: 27.3, … total 46.3.
const T = { phone: 0, promise: 4.2, ask: 7.8, work: 12.8, repair: 21.8, owner: 21.8, done: 27.8, app: 32.6, end: 36.2, total: 40.8 };
export const TOTAL = S(T.total);

type Mark = { name: string; t: number };
type Frame = { f: string; t: number };
export type LaunchProps = { frames: Frame[]; marks: { t0: number; events: Mark[] } };
const at = (m: LaunchProps['marks'], name: string, d: number) => (m.events.find(e => e.name === name)?.t ?? d) / 1000;

const C = { bg: '#101112', fg: '#f3f1ee', muted: '#9a9aa0', a1: '#e5623a', a2: '#f2a541', card: '#1c1d20', line: '#2a2c30' };
const font = 'Inter, "SF Pro Display", system-ui, -apple-system, "Segoe UI", sans-serif';

// ------------------------------------------------------------ pieces

const Glow: React.FC<{ x?: number; y?: number; size?: number; opacity?: number }> = ({ x = 540, y = 960, size = 1100, opacity = 0.35 }) => (
  <div style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: '50%',
    background: `radial-gradient(circle, ${C.a1}${Math.round(opacity * 255).toString(16).padStart(2, '0')} 0%, transparent 60%)`, filter: 'blur(40px)' }} />
);

// Kinetic line: words rise in one after another.
const Words: React.FC<{ text: string; start?: number; size?: number; color?: string; weight?: number; stagger?: number; y?: number; accent?: string[] }> =
  ({ text, start = 0, size = 92, color = C.fg, weight = 750, stagger = 4, y = 0, accent = [] }) => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `0 ${size * 0.26}px`, padding: '0 80px', transform: `translateY(${y}px)` }}>
        {text.split(' ').map((w, i) => {
          const p = spring({ frame: f - start - i * stagger, fps, config: { damping: 18, stiffness: 140, mass: 0.7 } });
          const hot = accent.includes(w.replace(/[.,!]/g, ''));
          return (
            <span key={i} style={{ fontFamily: font, fontSize: size, fontWeight: weight, letterSpacing: -size * 0.03, lineHeight: 1.08,
              color: hot ? 'transparent' : color, backgroundImage: hot ? `linear-gradient(90deg, ${C.a1}, ${C.a2})` : undefined,
              WebkitBackgroundClip: hot ? 'text' : undefined, backgroundClip: hot ? 'text' : undefined,
              opacity: p, transform: `translateY(${(1 - p) * size * 0.6}px)`, display: 'inline-block' }}>{w}</span>
          );
        })}
      </div>
    );
  };

// An old phone (vector): dark screen, then it powers on (a glow and the appetito sprout).
const OldPhone: React.FC = () => {
  const f = useCurrentFrame();
  const on = interpolate(f, [S(1.1), S(1.6)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const flicker = f > S(1.1) && f < S(1.35) ? (Math.sin(f * 2.3) > 0 ? 1 : 0.4) : 1;
  const lift = interpolate(f, [0, S(4.2)], [30, -20]);
  const tilt = interpolate(f, [0, S(4.2)], [-8, -3]);
  return (
    <div style={{ position: 'absolute', left: 540 - 210, top: 520, width: 420, height: 820, transform: `translateY(${lift}px) rotate(${tilt}deg)` }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 64, background: 'linear-gradient(160deg,#3a3b40,#1a1b1e)', boxShadow: '0 40px 90px rgba(0,0,0,.6), inset 0 0 0 3px #4a4b52' }} />
      <div style={{ position: 'absolute', inset: 22, borderRadius: 46, background: '#050506', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: on * flicker, background: `radial-gradient(circle at 50% 45%, ${C.a1}55, transparent 65%), ${C.bg}` }} />
        <svg viewBox="0 0 64 64" width={170} height={170} style={{ position: 'absolute', left: 103, top: 260, opacity: on * flicker, transform: `scale(${0.8 + 0.2 * on})` }}>
          <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={C.a1} /><stop offset="1" stopColor={C.a2} /></linearGradient></defs>
          <rect width="64" height="64" rx="14" fill="url(#g)" />
          <path d="M32 52V30" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" fill="none" />
          <path d="M32 33c0-9 6-15 16-15 0 10-6 16-16 15z" fill="#fff" />
          <path d="M32 38c0-7-5-12-13-12 0 8 5 12 13 12z" fill="#fff" opacity=".8" />
        </svg>
        {/* old-phone scratches */}
        <div style={{ position: 'absolute', left: 40, top: 120, width: 160, height: 2, background: '#ffffff14', transform: 'rotate(-24deg)' }} />
        <div style={{ position: 'absolute', left: 190, top: 520, width: 110, height: 2, background: '#ffffff10', transform: 'rotate(31deg)' }} />
      </div>
      <div style={{ position: 'absolute', left: 170, top: 36, width: 80, height: 8, borderRadius: 4, background: '#2c2d31' }} />
    </div>
  );
};

// A floating phone frame around the real footage, with optional zoom on a region.
const PhoneFrame: React.FC<{ children: React.ReactNode; scale?: number; y?: number; rot?: number }> = ({ children, scale = 1, y = 0, rot = 0 }) => (
  <div style={{ position: 'absolute', left: 540 - 300, top: 960 - 640 + y, width: 600, height: 1280, transform: `scale(${scale}) rotate(${rot}deg)`, transformOrigin: '50% 50%' }}>
    <div style={{ position: 'absolute', inset: -14, borderRadius: 78, background: 'linear-gradient(160deg,#2b2c31,#141517)', boxShadow: `0 60px 120px rgba(0,0,0,.65), 0 0 0 2px #3b3c42, 0 0 120px ${C.a1}22` }} />
    <div style={{ position: 'absolute', inset: 0, borderRadius: 64, overflow: 'hidden', background: C.bg }}>{children}</div>
  </div>
);

// The footage between moments of the recording (seconds), stretched to fill the sequence: at each
// video frame, the last screencast frame shown at that moment. `ranges` strings several cuts together.
const Clip: React.FC<{ frames: Frame[]; from?: number; to?: number; ranges?: [number, number][]; frames_: number }> = ({ frames, from = 0, to = 0, ranges, frames_ }) => {
  const f = useCurrentFrame();
  const rs = ranges ?? [[from, to]];
  let pos = rs.reduce((n, [a, b]) => n + (b - a), 0) * Math.min(1, f / Math.max(1, frames_ - 1));
  let t = rs[rs.length - 1][1];
  for (const [a, b] of rs) { if (pos <= b - a) { t = a + pos; break; } pos -= b - a; }
  t *= 1000;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m].t <= t) lo = m; else hi = m - 1; }
  const fr = frames[lo];
  return fr ? <Img src={staticFile(`frames/${fr.f}`)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} /> : null;
};

const Caption: React.FC<{ text: string; sub?: string; start?: number; accent?: string[] }> = ({ text, sub, start = 6, accent }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [start + 18, start + 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 120 }}>
      <Words text={text} start={start} size={74} accent={accent} />
      {sub ? <div style={{ fontFamily: font, fontSize: 36, color: C.muted, textAlign: 'center', marginTop: 18, opacity: o, letterSpacing: 0.5 }}>{sub}</div> : null}
    </div>
  );
};

const Badge: React.FC<{ text: string; start: number }> = ({ text, start }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - start, fps, config: { damping: 14, stiffness: 160 } });
  return (
    <div style={{ position: 'absolute', right: 120, top: 1500, padding: '14px 26px', borderRadius: 999, fontFamily: font, fontWeight: 800, fontSize: 52,
      color: '#fff', background: `linear-gradient(135deg, ${C.a1}, ${C.a2})`, transform: `scale(${p})`, boxShadow: `0 20px 50px ${C.a1}66` }}>{text}</div>
  );
};

// ------------------------------------------------------------ scenes

const ScenePhone: React.FC = () => (
  <AbsoluteFill>
    <Glow y={900} opacity={0.18} />
    <OldPhone />
    <div style={{ position: 'absolute', left: 0, right: 0, top: 240 }}><Words text="Avevo un telefono vecchio." start={14} size={96} accent={['vecchio']} /></div>
  </AbsoluteFill>
);

const ScenePromise: React.FC<LaunchProps> = ({ frames, marks }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f, fps, config: { damping: 20, stiffness: 90 } });
  return (
    <AbsoluteFill>
      <Glow y={1150} opacity={0.3} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150 }}>
        <Words text="Ora è un server" start={4} size={88} />
        <div style={{ height: 6 }} />
        <Words text="che si costruisce da solo." start={16} size={88} accent={['solo']} />
      </div>
      <PhoneFrame scale={0.78 + 0.08 * p} y={260 + (1 - p) * 500} rot={(1 - p) * 6}>
        <Clip frames={frames} from={at(marks, 'backlog', 3000) - 0.4} to={at(marks, 'backlog', 3000)} frames_={S(T.ask - T.promise)} />
      </PhoneFrame>
    </AbsoluteFill>
  );
};

const SceneAsk: React.FC<LaunchProps> = ({ frames, marks }) => {
  const f = useCurrentFrame();
  const z = interpolate(f, [0, S(T.work - T.ask)], [0.86, 0.98], { easing: Easing.inOut(Easing.cubic) });
  return (
    <AbsoluteFill>
      <Glow y={1150} opacity={0.25} />
      <Caption text="Gli chiedo una cosa." sub="«Aggiungi Vaultwarden» → Da fare" accent={['cosa']} />
      <PhoneFrame scale={z} y={240}>
        <Clip frames={frames} from={at(marks, 'drawer', 5000) - 0.6} to={at(marks, 'live', 12000)} frames_={S(T.work - T.ask)} />
      </PhoneFrame>
    </AbsoluteFill>
  );
};

const SceneWork: React.FC<LaunchProps> = ({ frames, marks }) => {
  const f = useCurrentFrame();
  const n = S(T.repair - T.work);
  const from = at(marks, 'live', 12000), to = at(marks, 'rolled-back', at(marks, 'handed', from * 1000 + 180000) * 1000);
  const speed = Math.max(1, Math.round((to - from) / (n / FPS)));
  const z = interpolate(f, [0, n], [0.95, 1.06], { easing: Easing.inOut(Easing.sin) });
  return (
    <AbsoluteFill>
      <Glow y={1100} opacity={0.32} />
      <Caption text="Lui la fa. Da solo." sub="niente root · test · deploy · rollback se si rompe" accent={['solo']} />
      <PhoneFrame scale={z} y={250}>
        <Clip frames={frames} from={from} to={to} frames_={n} />
      </PhoneFrame>
      <Badge text={`×${speed}`} start={S(0.8)} />
    </AbsoluteFill>
  );
};

// A check failed: the change was rolled back, the monitor opened an issue, the agent fixed it.
const SceneRepair: React.FC<LaunchProps> = ({ frames, marks }) => {
  const f = useCurrentFrame();
  const n = S(T.owner - T.repair);
  const rb = at(marks, 'rolled-back', 0), rs = at(marks, 'repair-start', 0), hd = at(marks, 'handed', 0);
  const ranges: [number, number][] = [[rb - 2, rb + 6], [rs, hd]];
  const speed = Math.max(1, Math.round((8 + hd - rs) / (n / FPS)));
  const z = interpolate(f, [0, n], [0.95, 1.04], { easing: Easing.inOut(Easing.sin) });
  return (
    <AbsoluteFill>
      <Glow y={1100} opacity={0.3} />
      <Caption text="Se si rompe, torna indietro. E si ripara." sub="test fallito · rollback · issue · riparato" accent={['ripara']} />
      <PhoneFrame scale={z} y={260}>
        <Clip frames={frames} ranges={ranges} frames_={n} />
      </PhoneFrame>
      <Badge text={`×${speed}`} start={S(0.8)} />
    </AbsoluteFill>
  );
};

// The handover: the agent asks only what needs the owner (their backup key, a root command).
const SceneOwner: React.FC<LaunchProps> = ({ frames, marks }) => {
  const f = useCurrentFrame();
  const n = S(T.done - T.owner);
  const z = interpolate(f, [0, n], [0.9, 0.98], { easing: Easing.inOut(Easing.cubic) });
  return (
    <AbsoluteFill>
      <Glow y={1100} opacity={0.28} />
      <Caption text="Mi chiede solo quello che tocca a me." sub="una chiave mia, un comando da root: il resto lo fa lui" accent={['me']} />
      <PhoneFrame scale={z} y={250}>
        <Clip frames={frames} from={at(marks, 'for-you', 196000)} to={at(marks, 'restarted', 210000)} frames_={n} />
      </PhoneFrame>
    </AbsoluteFill>
  );
};

const SceneDone: React.FC<LaunchProps> = ({ frames, marks }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = S(T.app - T.done);
  const closedAt = (at(marks, 'closed', 235000) - at(marks, 'live-again', 210000)) / (at(marks, 'done-drawer', 244000) - at(marks, 'live-again', 210000));
  const check = spring({ frame: f - Math.round(closedAt * n), fps, config: { damping: 12, stiffness: 120 } });
  return (
    <AbsoluteFill>
      <Glow y={1100} opacity={0.4} />
      <Caption text="Fatto. Testato. Installato." accent={['Fatto']} />
      <PhoneFrame scale={0.9} y={260}>
        <Clip frames={frames} from={at(marks, 'live-again', 210000)} to={at(marks, 'done-drawer', 244000)} frames_={n} />
      </PhoneFrame>
      <div style={{ position: 'absolute', left: 540 - 90, top: 1580, width: 180, height: 180, borderRadius: '50%', background: `linear-gradient(135deg, ${C.a1}, ${C.a2})`,
        transform: `scale(${check})`, display: 'grid', placeItems: 'center', boxShadow: `0 24px 60px ${C.a1}77` }}>
        <svg viewBox="0 0 24 24" width={110} height={110}><path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
    </AbsoluteFill>
  );
};

const SceneApp: React.FC<LaunchProps> = ({ frames, marks }) => (
  <AbsoluteFill>
    <Glow y={1100} opacity={0.3} />
    <Caption text="Da una frase a un servizio che gira." sub="Vaultwarden è solo l'esempio: chiedi quello che ti serve" accent={['servizio']} />
    <PhoneFrame scale={0.92} y={260}>
      <Clip frames={frames} from={at(marks, 'app', 75000)} to={at(marks, 'app-end', 79000)} frames_={S(T.end - T.app)} />
    </PhoneFrame>
  </AbsoluteFill>
);

const SceneEnd: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f, fps, config: { damping: 16, stiffness: 110 } });
  const o = (d: number) => interpolate(f, [d, d + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Glow y={820} opacity={0.45} />
      <svg viewBox="0 0 64 64" width={220} height={220} style={{ transform: `scale(${p}) rotate(${(1 - p) * -20}deg)`, marginTop: -260 }}>
        <defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={C.a1} /><stop offset="1" stopColor={C.a2} /></linearGradient></defs>
        <rect width="64" height="64" rx="14" fill="url(#g2)" />
        <path d="M32 52V30" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" fill="none" />
        <path d="M32 33c0-9 6-15 16-15 0 10-6 16-16 15z" fill="#fff" />
        <path d="M32 38c0-7-5-12-13-12 0 8 5 12 13 12z" fill="#fff" opacity=".8" />
      </svg>
      <div style={{ fontFamily: font, fontWeight: 800, fontSize: 132, color: C.fg, letterSpacing: -5, marginTop: 40, opacity: o(10) }}>appetito</div>
      <div style={{ fontFamily: font, fontSize: 48, color: C.a2, marginTop: 4, opacity: o(24), fontWeight: 600 }}>open source</div>
      <div style={{ fontFamily: font, fontSize: 40, color: C.muted, marginTop: 70, opacity: o(40) }}>github.com/gio-del/appetito</div>
      <div style={{ fontFamily: font, fontSize: 32, color: C.muted, marginTop: 22, opacity: o(56) }}>Claude Code o un modello locale</div>
      <div style={{ position: 'absolute', bottom: 70, fontFamily: font, fontSize: 22, color: C.muted, opacity: 0.7 * o(56) }}>Musica: “Inspired”, Kevin MacLeod (incompetech.com), CC BY 4.0</div>
    </AbsoluteFill>
  );
};

// Scene transitions: a short fade + slide between sequences.
const Fade: React.FC<{ children: React.ReactNode; dur: number }> = ({ children, dur }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 12, dur - 12, dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const marks_has = (p: LaunchProps, n: string) => p.marks.events.some(e => e.name === n);

export const Launch: React.FC<LaunchProps> = props => {
  const seq = (a: number, b: number, el: React.ReactNode, last = false) => (
    <Sequence from={S(a)} durationInFrames={S(b - a)}><Fade dur={last ? S(b - a) + 999 : S(b - a)}>{el}</Fade></Sequence>
  );
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {/* Background music (CC BY 4.0, credited on the last scene): `npm run music` fetches it. */}
      <Audio src={staticFile('music.mp3')} volume={f => 0.45 * interpolate(f, [0, FPS, TOTAL - 2.5 * FPS, TOTAL], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
      {seq(T.phone, T.promise, <ScenePhone />)}
      {seq(T.promise, T.ask, <ScenePromise {...props} />)}
      {seq(T.ask, T.work, <SceneAsk {...props} />)}
      {seq(T.work, T.repair, <SceneWork {...props} />)}
      {marks_has(props, 'repair-start') && T.owner > T.repair ? seq(T.repair, T.owner, <SceneRepair {...props} />) : null}
      {seq(T.owner, T.done, <SceneOwner {...props} />)}
      {seq(T.done, T.app, <SceneDone {...props} />)}
      {seq(T.app, T.end, <SceneApp {...props} />)}
      {seq(T.end, T.total, <SceneEnd />, true)}
    </AbsoluteFill>
  );
};
