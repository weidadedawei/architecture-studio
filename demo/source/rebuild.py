"""Rebuild the standalone page using only local source files and Python's standard library."""
from pathlib import Path
import json

source=Path(__file__).resolve().parent
destination=source.parent
book=json.loads((destination/'diagram-project.json').read_text(encoding='utf-8'))
data={'book':book,'icons':json.loads((source/'icons.json').read_text(encoding='utf-8')),'ui':json.loads((source/'ui.json').read_text(encoding='utf-8'))}
encoded=json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
html=(source/'shell.html').read_text(encoding='utf-8')
html=html.replace('<!--STYLES-->','<style>\n'+(source/'editor.css').read_text(encoding='utf-8')+'\n</style>')
html=html.replace('<!--DATA-->','<script id="editorData" type="application/json">'+encoded+'</script>')
html=html.replace('<!--APP-->','<script>\n'+(source/'app.js').read_text(encoding='utf-8')+'\n</script>')
(destination/'index.html').write_text(html,encoding='utf-8')
print('Built '+str(destination/'index.html'))
