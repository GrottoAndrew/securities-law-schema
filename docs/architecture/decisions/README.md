# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) documenting significant technical decisions.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](adr-001-audit-trail-technology.md) | Audit Trail Technology Selection | Accepted | 2026-01-19 |
| [ADR-002](adr-002-evidence-locker-modularity.md) | Evidence Locker Modularity | Accepted | 2026-01-19 |
| [ADR-003](adr-003-compliance-framework-alignment.md) | Compliance Framework Alignment | Accepted | 2026-01-19 |

## ADR Format

Each ADR follows this structure:
- **Status**: Proposed, Accepted, Deprecated, Superseded
- **Context**: Why we need to make this decision
- **Decision**: What we decided
- **Consequences**: What results from this decision
- **Compliance Mapping**: How this aligns with regulatory requirements

---

## Important Note: ADR Management in Production

While these ADRs are published in a public repository for reference and transparency, **production deployments should manage ADRs in a protected, auditable documentation system** that provides:

- Version control with tamper-evident history
- Access controls and audit trails
- Approval workflows
- Search and cross-referencing
- Integration with compliance evidence

### Recommended ADR Documentation Platforms

The following tools are organized by organizational scale and compliance maturity. Selection should consider your regulatory obligations, team size, and integration requirements.

#### Tier 1: Individual / Small Team (Free - Low Cost)

| Tool | Description | Best For |
|------|-------------|----------|
| **Obsidian** | Local-first Markdown knowledge base with graph visualization, linking, and plugins. Can sync via Git or paid Obsidian Sync. | Small teams, privacy-conscious orgs, those wanting full data control |
| **Logseq** | Open-source outliner with bidirectional linking. Git-based storage. | Teams preferring outliner-style documentation |
| **Notion** (Free tier) | Collaborative workspace with databases, templates, and basic permissions. | Startups, small teams needing quick setup |
| **HackMD / CodiMD** | Collaborative Markdown editor with Git integration. Self-hostable. | Developer-centric teams, open-source projects |
| **ADR Tools** (adr-tools) | CLI tool by Nat Pryce for managing ADRs as Markdown in Git repositories. | Engineering teams comfortable with CLI |
| **Log4brains** | ADR management tool that generates a static site from Markdown ADRs. | Teams wanting auto-generated ADR documentation sites |

**Considerations**: Free tools typically lack enterprise audit trails, SOC 2 attestations, and advanced access controls. Suitable for early-stage documentation but may require migration as compliance requirements mature.

#### Tier 2: Growing Teams / Departmental (Mid-Market)

| Tool | Description | Best For |
|------|-------------|----------|
| **Confluence** (Cloud) | Atlassian's wiki platform with templates, permissions, and Jira integration. | Teams already using Atlassian stack |
| **Notion** (Team/Business) | Enhanced permissions, admin controls, SAML SSO, audit logs. | Mid-size companies, cross-functional teams |
| **GitBook** | Documentation platform with Git sync, versioning, and access controls. | Developer documentation, API-heavy orgs |
| **Slite** | Knowledge base focused on structured documentation with verification workflows. | Teams needing document freshness tracking |
| **Tettra** | Knowledge management with Slack integration and verification requests. | Slack-centric organizations |
| **Almanac** | Documentation platform with handbook-style organization and workflows. | Policy and procedure documentation |

**Considerations**: Mid-tier tools offer better access controls and some audit capabilities. Verify SOC 2 Type II status and data residency options before selecting for regulated workloads.

#### Tier 3: Enterprise / Regulated Industries

| Tool | Description | Best For | Compliance Notes |
|------|-------------|----------|------------------|
| **Confluence Data Center** | Self-hosted Confluence with enterprise controls, HA, and data residency. | Large enterprises, data sovereignty requirements | SOC 2, ISO 27001, configurable retention |
| **SharePoint** | Microsoft's enterprise content management with records management features. | Microsoft-centric enterprises | FedRAMP High, HIPAA, many certifications |
| **ServiceNow** (Knowledge Management) | ITSM platform with integrated knowledge base, workflows, and audit trails. | Enterprises with ServiceNow investment | SOC 2, FedRAMP, HIPAA eligible |
| **Guru** | Knowledge management with verification workflows and browser extension. | Customer-facing teams, distributed knowledge | SOC 2 Type II |
| **Document360** | Knowledge base platform with versioning, analytics, and enterprise security. | Technical documentation at scale | SOC 2 Type II |

**Considerations**: Enterprise tools provide robust audit trails, compliance certifications, and integration with GRC platforms. Evaluate total cost of ownership including implementation and training.

#### Tier 4: GRC-Integrated / Compliance-First

For organizations where ADRs are formal compliance artifacts requiring evidence collection, control mapping, and audit support:

| Tool | Description | Best For | Compliance Notes |
|------|-------------|----------|------------------|
| **OneTrust** | Privacy, security, and GRC platform with policy management and evidence collection. | Enterprises with complex regulatory obligations | Comprehensive compliance coverage |
| **Workiva** | Connected reporting and compliance platform with SOX, ESG, and audit support. | Public companies, financial services | SEC filing integration, SOC 1/2 |
| **AuditBoard** | Audit, risk, and compliance management with evidence collection and workflows. | Internal audit teams, SOX compliance | SOC 2, purpose-built for audit |
| **Archer (RSA)** | Enterprise GRC platform with configurable workflows and reporting. | Large enterprises with complex GRC needs | Extensive framework support |
| **LogicGate** | Risk and compliance platform with process automation and integrations. | Mid-to-large enterprises | SOC 2, flexible configuration |
| **Vanta** | Continuous compliance monitoring with evidence collection automation. | SaaS companies, SOC 2/ISO focused | Automated evidence collection |
| **Drata** | Compliance automation platform with continuous monitoring. | Growth-stage companies seeking certifications | SOC 2, ISO 27001, HIPAA |
| **Secureframe** | Compliance automation with policy management and vendor risk. | Startups to mid-market | SOC 2, ISO 27001, HIPAA, PCI |
| **Hyperproof** | Compliance operations platform with evidence management and frameworks. | Compliance teams managing multiple frameworks | Multi-framework support |
| **ZenGRC** (Reciprocity) | GRC platform with risk management and compliance mapping. | Risk and compliance teams | SOC 2, framework mapping |

**Considerations**: GRC platforms treat ADRs as formal control artifacts with evidence linkage, approval workflows, and audit trails. Higher cost but essential for regulated industries with examination obligations.

### Selection Criteria

When selecting an ADR management platform, evaluate:

| Criterion | Questions to Ask |
|-----------|------------------|
| **Audit Trail** | Does it maintain tamper-evident version history? Can you prove when decisions were made and by whom? |
| **Access Control** | Can you restrict who can view, edit, and approve ADRs? Does it support your identity provider? |
| **Compliance Certifications** | Is the platform SOC 2 Type II certified? Does it meet your regulatory requirements (FedRAMP, HIPAA, etc.)? |
| **Retention & Legal Hold** | Can you enforce retention policies? Support legal holds for litigation? |
| **Search & Discovery** | Can auditors easily find relevant decisions? Does it support cross-referencing? |
| **Integration** | Does it integrate with your GRC platform, ticketing system, and CI/CD pipeline? |
| **Data Residency** | Where is data stored? Can you meet data sovereignty requirements? |
| **Export & Portability** | Can you export ADRs in standard formats? Avoid vendor lock-in? |
| **Workflow** | Does it support approval workflows matching your governance requirements? |
| **Cost Model** | Per-user, per-document, or flat fee? What's the TCO including implementation? |

### Recommended Approach

1. **Start with Git + Markdown** for engineering-driven ADRs during development
2. **Migrate to a knowledge platform** (Notion, Confluence, GitBook) as the team grows
3. **Integrate with GRC tooling** when compliance becomes a formal program with audit obligations
4. **Maintain export capability** — always be able to extract ADRs in portable formats

### References

For deeper exploration of ADR practices and tooling:

- Michael Nygard, ["Documenting Architecture Decisions"](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — The original ADR proposal
- Joel Parker Henderson, [Architecture Decision Record (ADR) Examples](https://github.com/joelparkerhenderson/architecture-decision-record) — Comprehensive ADR templates and guidance
- ThoughtWorks Technology Radar — Regularly evaluates documentation and ADR tools
- NIST SP 800-53 Rev. 5, SA-5 — System documentation requirements for federal systems
