# Ring 4 — Skill Integrity

2AIO runs **66 vendored third-party skills**. A poisoned or drifted upstream skill is a supply-
chain risk *inside the agent itself*. This ring audits and pins the framework's own skills.

| Tool | Purpose | Invoke | License |
|---|---|---|---|
| **SkillSpector** (NVIDIA) | Scan a skill for vulnerabilities / malicious patterns / prompt-injection | `docker run --rm -v "$PWD:/scan" skillspector scan ./<skill>/ --no-llm` | see upstream |
| **SkilLock** | Pin approved skill behavior; block unapproved drift in CI | `skil-lock` (baseline → detect drift → approve) | Apache-2.0 |

## Recommended workflow
1. **On vendor/update** of any skill (anything under `skills/`), run SkillSpector over the
   changed folder. Anything flagged CRITICAL → do not ship that skill update.
2. **Pin with SkilLock**: capture a baseline of the vetted skill set, commit the lockfile.
   CI re-checks on every PR; a silent upstream change to a vendored skill fails the build.

```bash
# audit every vendored skill (skip LLM checks for speed/offline)
for d in skills/*/*/; do
  [ -f "$d/SKILL.md" ] || continue
  docker run --rm -v "$PWD:/scan" skillspector scan "/scan/$d" --no-llm
done
```

## Why this matters here
The whole value of "vendor everything" is undercut if one upstream repo is later compromised.
Because 2AIO pulls from ~8 independent authors, Ring 4 is what makes the aggregation *safe*
rather than just large. Run it in CI, gate merges on it.
