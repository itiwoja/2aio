import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ["CLAUDE_ENFORCE_RULES"] = os.path.join(HERE, "enforce-rules.json")
BIG = "\n".join(f"const x{i}={i};" for i in range(60))   # 60 lines of code
SMALL = "\n".join(["line"] * 10)                          # 10 lines

def run(payload):
    p = subprocess.run([sys.executable, os.path.join(HERE, "delegation-enforcer.py")],
                       input=json.dumps(payload), capture_output=True, text=True)
    return p.returncode

cases = [
    ("BLOCK big new app.js in /tmp", 2,
     {"tool_name":"Write","tool_input":{"file_path":"C:/tmp/app.js","content":BIG}}),
    ("ALLOW Edit (not Write)", 0,
     {"tool_name":"Edit","tool_input":{"file_path":"C:/tmp/app.js","content":BIG}}),
    ("ALLOW big .md doc", 0,
     {"tool_name":"Write","tool_input":{"file_path":"C:/tmp/plan.md","content":BIG}}),
    ("ALLOW small .js (10 lines)", 0,
     {"tool_name":"Write","tool_input":{"file_path":"C:/tmp/util.js","content":SMALL}}),
    ("ALLOW big file inside 2AIO repo", 0,
     {"tool_name":"Write","tool_input":{"file_path":"C:/tmp/2aio-smoketest/harness/x/new.mjs","content":BIG}}),
    ("ALLOW big test file", 0,
     {"tool_name":"Write","tool_input":{"file_path":"C:/tmp/app.test.js","content":BIG}}),
    ("ALLOW big .json config", 0,
     {"tool_name":"Write","tool_input":{"file_path":"C:/tmp/data.json","content":BIG}}),
    ("BLOCK big new index.html app", 2,
     {"tool_name":"Write","tool_input":{"file_path":"C:/tmp/site/index.html","content":BIG}}),
]

ok = True
for name, want, payload in cases:
    got = run(payload)
    mark = "PASS" if got == want else "FAIL"
    if got != want: ok = False
    print(f"  [{mark}] exit={got} want={want}  {name}")
print("ALL PASS" if ok else "SOME FAILED")
sys.exit(0 if ok else 1)
