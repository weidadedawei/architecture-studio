import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
project = json.loads((root / "demo/diagram-project.json").read_text(encoding="utf-8"))
diagram = project["diagrams"]["system"]
node = next(n for n in diagram["nodes"] if n["id"] == "manager")
node["name"] = "运营工作台"
node["x"] += 15
node["y"] += 5
diagram["translations"]["zh-CN"]["node.manager.name"] = "运营工作台"
diagram["translations"]["en"]["node.manager.name"] = "Operations UI"
project["storageId"] = "customized-teaching-example"
output = root / "examples/02-customized-project.json"
output.write_text(json.dumps(project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Generated:", output.name)
