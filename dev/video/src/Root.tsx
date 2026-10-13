import React from 'react';
import { Composition, staticFile } from 'remotion';
import { Launch, FPS, TOTAL, LaunchProps } from './Launch';

// Footage and its marks come from record.js (copied into public/ by prepare.sh).
export const Root: React.FC = () => (
  <Composition id="Launch" component={Launch} durationInFrames={TOTAL} fps={FPS} width={1080} height={1920}
    defaultProps={{ footage: staticFile('footage.webm'), marks: { t0: 0, events: [] } } as LaunchProps}
    calculateMetadata={async ({ props }) => {
      try {
        const r = await fetch(staticFile('marks.json'));
        if (r.ok) return { props: { ...props, marks: await r.json() } };
      } catch {}
      return { props };
    }} />
);
