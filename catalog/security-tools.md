# 2AIO External Security-Tool Catalog

The 4-ring [`../security/`](../security/) layer covers what 2AIO installs and invokes by default
(code scanners, guardrails, sandbox, skill integrity). **This catalog is the wider universe** —
the standalone security tools 2AIO's security agents should *know to reach for* when a task calls
for it, mapped to purpose. These are external products/CLIs (many not npm/pip-installable, some
commercial); 2AIO invokes or references them rather than vendoring.

> Canonical registries (kept cloned, the source of truth for this catalog):
> - `dev/skills/awesome-security/` — sbilly/awesome-security (MIT)
> - `dev/skills/awesome-claude-code/` — hesreallyhim/awesome-claude-code
> When a security task needs a tool not listed here, grep those READMEs first.

## By purpose

### Secret / credential
- **gitleaks** (default, wired) — repo secret scan. **Keyscope** — validate found keys against live SaaS. **authsome** — credential gateway so agents never see raw keys.

### SAST / code security
- **Bearer, Insider, Scanmycode-CE** (multi-language SAST), **recon** (SQL-query code/malware), **Semgrep** (rules-based, catalogued). → prefer Bearer for security+PII, Insider for JVM/.NET/Swift.

### IaC / cloud config
- **Checkov, KICS, TFSec, Terrascan** — Terraform/k8s/Docker/CFN misconfig. → Checkov+KICS wired.

### Supply chain
- **shai-hulud-scanner, react2shell-scanner** (wired), **SkillSpector, SkilLock** (skill integrity), **is-website-vulnerable** (vuln JS libs), **pompelmi** (upload malware).

### Web app / DAST
- **OWASP ZAP, w3af, Nikto, Wapiti** — dynamic scanning. **sqlmap** — SQL injection. **Recon-ng** — web recon. **Artemis** — modular scanner + reports. → invoke ZAP/sqlmap against a running preview URL for deployed web apps.

### WAF / RASP (defensive runtime)
- **ModSecurity, BunkerWeb, NAXSI, Curiefense, open-appsec** (WAF), **OpenRASP, Sqreen** (RASP). → reference when a 2AIO-built app needs production hardening.

### Network / scanning / monitoring
- **nmap, masscan** (scan), **Wireshark, tcpdump** (capture), **Snort, Suricata, Zeek** (IDS), **Wazuh, OSSEC** (HIDS), **the Elastic/OpenSearch SIEM stack** (SIEM).

### Threat intel / OSINT
- **MISP, OpenCTI** (threat-intel platforms), **theHarvester, SpiderFoot** (OSINT), **Spyse** (asset search).

### Exploits / payloads (offensive, authorized testing only)
- **PayloadsAllTheThings** (wired reference DB), **Metasploit** (framework), **Nuclei** (templated scanning). → CTF / authorized pentest contexts only; see repo-root safety policy.

### Endpoint / forensics
- **ClamAV** (AV), **Volatility, Autopsy, SleuthKit** (forensics), **YARA** (pattern matching; `pompelmi` can use YARA rules).

### DevOps / sandbox
- **cleat, brood-box, code-on-incus, machine, aicontainer** (agent isolation, wired), **Trivy, Grype** (container/image vuln scan, catalogued).

## Usage policy
- **Defensive & authorized only.** Offensive tools (sqlmap, Metasploit, Nuclei, PayloadsAllTheThings)
  are for CTF, authorized pentests, and security research — matching the framework's operating
  policy. 2AIO refuses destructive/mass-targeting/evasion use.
- **Install on demand.** None of these ship in the default install; the security agent installs
  the specific tool a task needs (package manager / binary / docker) and records it in the run log.
- **Not exhaustive.** This maps the *categories* comprehensively with representative tools; the
  two awesome-lists above hold the long tail (hundreds of entries, books, SaaS).
