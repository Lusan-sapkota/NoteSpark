// The desktop draws a ```mermaid block in the page itself; the library loads on first use (a separate chunk).
import React, { useEffect, useState } from 'react';
import { mermaidMistake } from '@notespark/core';
import MermaidShell from '../../../../../../mobile/src/components/MermaidShell';
import { useTheme } from '../../../../../../mobile/src/theme/ThemeContext';

let counter = 0;

const MermaidDiagram: React.FC<{ code: string }> = ({ code }) => {
  const { theme, isDarkMode } = useTheme();
  const [svg, setSvg] = useState('');
  const [mistake, setMistake] = useState<string | null>(null);
  const c = theme.colors;
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        // Strict level: no HTML or scripts from the diagram text.
        mermaid.initialize({
          startOnLoad: false, securityLevel: 'strict', theme: 'base',
          themeVariables: {
            darkMode: isDarkMode, background: c.background, textColor: c.onSurface, lineColor: c.onSurfaceVariant,
            primaryColor: c.primaryContainer, primaryTextColor: c.onPrimaryContainer, primaryBorderColor: c.primary,
            secondaryColor: c.secondaryContainer, secondaryTextColor: c.onSecondaryContainer,
            tertiaryColor: c.tertiaryContainer, tertiaryTextColor: c.onTertiaryContainer,
            noteBkgColor: c.surfaceContainerHigh, noteTextColor: c.onSurface,
          },
        });
        const out = await mermaid.render(`mermaid-${++counter}`, code);
        if (live) { setSvg(out.svg); setMistake(null); }
      } catch (e) {
        if (live) setMistake(mermaidMistake(e));
        document.getElementById(`dmermaid-${counter}`)?.remove(); // Mermaid leaves an error graphic in the page
      }
    })();
    return () => { live = false; };
  }, [code, isDarkMode]);

  return (
    <MermaidShell code={code} mistake={mistake}>
      <div style={{ overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: svg }} />
    </MermaidShell>
  );
};

export default MermaidDiagram;
