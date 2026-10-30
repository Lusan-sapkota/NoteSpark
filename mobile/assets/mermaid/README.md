# Mermaid

`mermaid.min.txt` is `dist/mermaid.min.js` from [mermaid](https://github.com/mermaid-js/mermaid) 12.2.0 (MIT), renamed so Metro bundles it as an asset. `src/components/MermaidDiagram.tsx` copies it to the cache folder and loads it from disk in a local web view; nothing is downloaded at run time.

To update: `npm i mermaid@<version> --ignore-scripts` in a scratch folder and copy `node_modules/mermaid/dist/mermaid.min.js` here.
