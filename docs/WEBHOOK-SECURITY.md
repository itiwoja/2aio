# Webhook security policy

Webhook notifications use public HTTPS destinations only. Before a request is
made, 2AIO resolves the hostname once, rejects the entire result set if any
A/AAAA address is not globally routable, and pins the HTTP connection to a
validated address. Redirects are treated as failures and are never followed.
Environment proxies and pooled sockets are bypassed, requests time out after ten
seconds, and URL credentials and fragments are rejected.

For a self-hosted local relay, set `AIO_LOCAL_WEBHOOK_URL` in the parent
control-plane process to the exact webhook URL. The URL must use the literal
host `127.0.0.1` or `::1`; its scheme, port, path, and query must match the
configured webhook exactly. Private, LAN, and hostname-based relays are not
allowed.

Worker environment scrubbing selects only the authentication variables needed
by the resolved `claude` or `codex` executable. `worker.envKeep` is additive
for explicitly required credentials and is validated as a regular expression;
it cannot replace the selected provider baseline. `HOME`, `USERPROFILE`,
`CLAUDE_CONFIG_DIR`, and `CODEX_HOME` remain available so persisted provider
logins continue to work. Connection-string variables, Docker credentials, and
credential-bearing URL values (including scheme-less proxy values) are removed;
an uncredentialed proxy URL may be retained. An invalid `worker.envKeep` type or
pattern fails the affected job before a worker is started.

These controls reduce accidental credential inheritance and SSRF exposure; they
are not containment against a hostile process running as the same operating
system user.
