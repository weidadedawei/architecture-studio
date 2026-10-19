"""Prepare static hosting output and a downloadable public source bundle."""
from pathlib import Path
import argparse, json, shutil, zipfile, os

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=root/'web-dist')
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
shutil.copy2(root/'demo/index.html', output/'index.html')
for name in ('guide.html','deploy.html','404.html'):
    shutil.copy2(root/'web'/name, output/name)
for folder in ('images','examples'):
    (output/folder).mkdir(exist_ok=True)
    for file in (root/folder).iterdir():
        if file.is_file() and not file.name.startswith('.') and file.suffix.lower() in ('.png','.svg','.drawio','.json'):
            shutil.copy2(file,output/folder/file.name)
health={'status':'ok','app':'Device Demo Architecture Studio','diagrams':['system','network'],'locales':['zh-CN','en'],'purpose':'static-site-availability','data':'fictional-demo-only','sourceCommit':os.environ.get('GITHUB_SHA','local-build')}
(output/'health.json').write_text(json.dumps(health,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(output/'downloads').mkdir(exist_ok=True)
archive=output/'downloads/Architecture_Studio_CSDN.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for file in sorted(root.rglob('*')):
        if not file.is_file():continue
        relative=file.relative_to(root)
        if output==file or output in file.parents:continue
        if any(part in {'node_modules','__pycache__','.git','.openai','web-dist'} for part in relative.parts):continue
        if file.suffix in ('.pyc','.zip') or file.name in {'.DS_Store','manifest.json'} or any(part.startswith('._') for part in relative.parts):continue
        z.write(file,Path('Architecture_Studio_CSDN')/relative)
print('Static hosting output ready:', output.name)
print('Editor, tutorial, images, examples, static marker, and source download included.')
