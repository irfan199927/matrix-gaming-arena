# Tools

Python scripts for deterministic execution. Each script should:
- Accept inputs via CLI args or stdin
- Print results to stdout
- Exit with non-zero code on failure
- Load secrets from `.env` via `python-dotenv`

## Conventions
- One responsibility per script
- No hardcoded credentials
- Readable error messages
