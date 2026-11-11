"""重新生成 TS 移植的对数期望值。

用 python/非强制就近接入.py 重算 src/app/project/action-sequence/nonforced-entry.fixtures.json 里
每组输入的结果，写回各组的 expected。改了算法后运行一次，再跑
npx vitest run src/app/project/action-sequence/nonforced-entry.spec.ts 看 TS 是否逐条一致。

用法：python3 python/非强制就近接入-对数.py
"""

import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent / "src" / "app" / "project" / "action-sequence" / "nonforced-entry.fixtures.json"


def _algorithm():
    spec = importlib.util.spec_from_file_location("nonforced_entry", HERE / "非强制就近接入.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    algorithm = _algorithm()
    fixture = json.loads(FIXTURES.read_text(encoding="utf-8"))
    for case in fixture["cases"]:
        parameters = {key: case[key] for key in ("command", "settings", "runtime")}
        parameters["models"] = fixture["models"][case["models"]]
        case["expected"] = algorithm.calculate_nonforced_entry(json.loads(json.dumps(parameters)))
    fixture["algorithm_version"] = algorithm.ALGORITHM_VERSION
    FIXTURES.write_text(json.dumps(fixture, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    statuses = {}
    for case in fixture["cases"]:
        statuses[case["expected"]["status"]] = statuses.get(case["expected"]["status"], 0) + 1
    print(f"{len(fixture['cases'])} 组：{statuses}，已写回 {FIXTURES}")


if __name__ == "__main__":
    main()
