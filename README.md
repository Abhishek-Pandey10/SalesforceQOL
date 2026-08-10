# SalesforceQOL

A collection of local, zero-deploy quality-of-life tools for working with
Salesforce orgs.

| Tool | What it does |
|------|--------------|
| [apex-org-diff](apex-org-diff/) | Compare Apex classes between two org folders (Monaco diff viewer) |
| [lwc-org-diff](lwc-org-diff/) | Compare Lightning Web Components between two org folders (bundle-aware Monaco diff viewer) |

`samples/` holds shared fixture orgs used by both tools' dev scripts. Each
tool is self-contained (its own `requirements.txt`, `README.md`, and local
web server) - see its own README for setup and usage.