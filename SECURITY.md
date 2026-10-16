# Security

Payload Radar is a static browser application and a local Node.js CLI. Payloads are processed locally. The application contains no payload upload endpoint, browser persistence, analytics, third-party scripts or external font requests. A hosting provider still receives requests for the page and its assets.

## Report a vulnerability

Please avoid posting sensitive payloads, credentials or working exploit details in a public issue. Use the repository's GitHub private vulnerability reporting option when available. If it is unavailable, open an issue asking for a private reporting channel without disclosing the vulnerability details.

Include the affected commit or version, environment, a minimal synthetic reproduction, impact and any proposed fix. The project is maintained on a best-effort basis; no response-time guarantee is offered. Security fixes target the latest release and `main`.

## Relevant boundaries

- Both inputs are bounded by byte size, top-level sample count, nesting depth and visited value count.
- The browser escapes sample-derived text before rendering it and keeps raw evidence in memory. It does not send payloads in URLs or store them in browser storage.
- Markdown and JSON reports contain structure, field names, file names and counts, without raw sample values. Schema drafts also contain field names. Review exports before sharing them.
- The CLI reads local regular files, rejects final file symlinks, and creates output files exclusively without overwriting existing files. It supports symlinked parent directories.
- The development server binds to `127.0.0.1`, serves a restricted set of static paths, and rejects requests that resolve outside its app directory. It is a local development tool.
- The static build explicitly copies app files. Git metadata, environment files and CLI scripts are not part of the deployed artifact.

Sample inference cannot validate an external API contract. Treat generated schemas and change severities as review material.
