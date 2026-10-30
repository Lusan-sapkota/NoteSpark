import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { ActivityIndicator } from 'react-native-paper';
import { mermaidMistake } from '@notespark/core';
import MermaidShell from './MermaidShell';
import { useI18n } from '../i18n/I18nContext';
import { useTheme } from '../theme/ThemeContext';
import { space } from '../theme/theme';

// The viewer page. Mermaid's bundle is copied next to it as mermaid.js and loaded from disk: nothing comes from
// the network. The policy allows no connections or images from anywhere, and Mermaid runs at its strict
// security level, so a diagram's text can't run scripts or fetch anything.
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src file: 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<style>html,body{margin:0;background:transparent;overflow-y:hidden}#o{display:block}</style>
<script src="mermaid.js"></script></head><body><div id="o"></div><script>
var post=function(m){window.ReactNativeWebView.postMessage(JSON.stringify(m))};
window.renderDiagram=function(code,t){
  mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',themeVariables:t});
  mermaid.render('d',code).then(function(r){
    var o=document.getElementById('o');o.innerHTML=r.svg;
    var s=o.querySelector('svg');
    if(s){var w=s.viewBox&&s.viewBox.baseVal?s.viewBox.baseVal.width:0,c=document.body.clientWidth;
      var wide=w&&w*0.6>c;
      if(wide){s.style.maxWidth='none';s.style.width=Math.round(w*0.6)+'px'}
      document.body.style.overflowX=wide?'auto':'hidden';}
    post({t:'size',h:Math.ceil(o.getBoundingClientRect().height)+8});
  }).catch(function(e){post({t:'error',m:String(e&&e.message||e)})});
};
</script></body></html>`;

let viewer: Promise<string> | null = null;
const prepareViewer = () =>
  (viewer ??= (async () => {
    const dir = `${FileSystem.cacheDirectory}mermaid/`;
    const [script] = await Asset.loadAsync(require('../../assets/mermaid/mermaid.min.txt'));
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const copy = await FileSystem.getInfoAsync(`${dir}mermaid.js`);
    const original = await FileSystem.getInfoAsync(script.localUri!);
    if (!copy.exists || !original.exists || copy.size !== original.size) {
      await FileSystem.deleteAsync(`${dir}mermaid.js`, { idempotent: true });
      await FileSystem.copyAsync({ from: script.localUri!, to: `${dir}mermaid.js` });
    }
    await FileSystem.writeAsStringAsync(`${dir}diagram.html`, PAGE);
    return `${dir}diagram.html`;
  })().catch(e => { viewer = null; throw e; }));

// A ```mermaid block drawn in a small local web view. Wide diagrams scroll sideways.
const MermaidDiagram: React.FC<{ code: string }> = ({ code }) => {
  const { theme, isDarkMode } = useTheme();
  const { t } = useI18n();
  const [page, setPage] = useState<string | null>(null);
  const [height, setHeight] = useState(120);
  const [mistake, setMistake] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    prepareViewer().then(p => live && setPage(p), e => live && setMistake(t('note.diagramViewerFailed', { reason: mermaidMistake(e) })));
    return () => { live = false; };
  }, []);
  useEffect(() => setMistake(null), [code]);

  const c = theme.colors;
  const colors = {
    darkMode: isDarkMode, background: c.background, textColor: c.onSurface, lineColor: c.onSurfaceVariant,
    primaryColor: c.primaryContainer, primaryTextColor: c.onPrimaryContainer, primaryBorderColor: c.primary,
    secondaryColor: c.secondaryContainer, secondaryTextColor: c.onSecondaryContainer,
    tertiaryColor: c.tertiaryContainer, tertiaryTextColor: c.onTertiaryContainer,
    noteBkgColor: c.surfaceContainerHigh, noteTextColor: c.onSurface,
  };
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.t === 'size' && typeof m.h === 'number') setHeight(m.h);
      else if (m.t === 'error') setMistake(mermaidMistake(m.m));
    } catch {}
  };

  return (
    <MermaidShell code={code} mistake={mistake}>
      {page ? (
        <WebView
          key={`${code}|${isDarkMode}`}
          source={{ uri: page }}
          originWhitelist={['file://*']}
          onShouldStartLoadWithRequest={req => req.url.startsWith('file://')}
          allowFileAccess
          allowingReadAccessToURL={page}
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          mixedContentMode="never"
          textZoom={100}
          overScrollMode="never"
          nestedScrollEnabled
          onMessage={onMessage}
          injectedJavaScript={`window.renderDiagram(${JSON.stringify(code)}, ${JSON.stringify(colors)}); true;`}
          style={{ height, backgroundColor: 'transparent' }}
        />
      ) : (
        <View style={{ height: 120, justifyContent: 'center', paddingVertical: space.md }}><ActivityIndicator /></View>
      )}
    </MermaidShell>
  );
};

export default MermaidDiagram;
