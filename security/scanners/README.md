# Ring 3 — Code Scanners

SAST, secret, IaC, and supply-chain scanners that 2AIO runs on the code it generates,
before commit/deploy. Tools are installed via their own package managers (not vendored).

## Tool registry

| Tool | Scans for | Install | Invoke on `.` | License |
|---|---|---|---|---|
| **Bearer** | Security risks + PII/sensitive-data flows | `brew install bearer/tap/bearer` or docker | `bearer scan .` | Elastic-2.0 |
| **Checkov** | IaC misconfig (Terraform, k8s, Docker, CFN) | `pip install checkov` | `checkov -d .` | Apache-2.0 |
| **KICS** | IaC misconfig (multi-platform) | docker `checkmarx/kics` | `kics scan -p .` | Apache-2.0 |
| **Insider** | SAST (Java, Kotlin, Swift, .NET, JS) | binary release | `insider --tech <t> --target .` | MIT |
| **Keyscope** | Validate leaked keys against live SaaS | `cargo install` / binary | `keyscope scan ...` | Apache-2.0 |
| **is-website-vulnerable** | Known-vuln frontend JS libs on a live URL | `npx` | `npx is-website-vulnerable <url>` | MIT |
| **pompelmi** | Upload malware / ZIP-bomb / MIME sniffing | `npm i pompelmi` | node API | MIT |
| **recon** | SQL-queryable file/code/malware classification | `cargo install recon` | `recon ...` | MIT |
| **react2shell-scanner** | CVE-2025-55182 RCE in React 19 / Next.js | `npx` | `npx react2shell-scanner` | MIT |
| **shai-hulud-scanner** | Shai-Hulud 2.0 npm supply-chain IoCs | `npx` | `npx shai-hulud-scanner` | MIT |

> `gitleaks` (secret scan) is already required by the deploy gate in `/2aio-build`.
> The `scan.sh` runner below treats every tool as optional: it runs whatever is installed
> and skips the rest with a note (no silent gaps).

## Usage

```bash
# run every installed scanner against a directory, aggregate results
bash security/scanners/scan.sh /path/to/project

# or scan the current repo
bash security/scanners/scan.sh .
```

Findings are written to `security/scanners/_reports/<timestamp>/` and summarized to stdout.
CRITICAL secret leaks or SAST CRITICAL findings exit non-zero (block deploy), matching the
absolute safety line in `/2aio-build` Phase 5-pre.

## Which scanner for which stack
- **Web/JS app** → is-website-vulnerable (live), react2shell/shai-hulud (supply-chain), Bearer
- **Has IaC (Terraform/k8s/Docker)** → Checkov + KICS
- **Backend (Java/Kotlin/.NET/Swift)** → Insider + Bearer
- **Any repo pre-commit** → gitleaks (secrets) + Keyscope (validate any hits)
