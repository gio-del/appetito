import React from 'react';
import { Composition, staticFile } from 'remotion';
import { Launch, FPS, TOTAL, LaunchProps } from './Launch';

// Footage (screencast frames) and marks come from record.js; `npm run footage` copies them into public/.
export const Root: React.FC = () => (
  <Composition id="Launch" component={Launch} durationInFrames={TOTAL} fps={FPS} width={1080} height={1920}
    defaultProps={{ frames: [], marks: { t0: 0, events: [] } } as LaunchProps}
    calculateMetadata={async ({ props }) => {
      try {
        const [m, f] = await Promise.all([fetch(staticFile('marks.json')), fetch(staticFile('frames.json'))]);
        if (m.ok && f.ok) return { props: { ...props, marks: await m.json(), frames: await f.json() } };
      } catch {}
      return { props };
    }} />
);
