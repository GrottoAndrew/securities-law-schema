# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) documenting significant technical decisions.

---

## Disclaimer

**This repository contains reference architecture documentation, not legal or compliance advice.**

- Regulatory text must be verified against current eCFR before reliance
- Compliance determinations require qualified legal and compliance professionals
- Architecture patterns are illustrative; production implementations require security review
- No vendor endorsement is implied by any technology references

---

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

---

## Terminology

Before selecting tooling, understand these terms:

| Term | Definition |
|------|------------|
| **GRC** | Governance, Risk, and Compliance. Software platforms that help organizations manage policies, assess risks, and demonstrate regulatory compliance. These tools typically include control libraries, evidence collection, audit workflows, and reporting. |
| **SBOM** | Software Bill of Materials. A formal, machine-readable inventory of software components and dependencies in a codebase. Required by some regulations and useful for vulnerability management. |
| **ADR** | Architecture Decision Record. A document capturing a significant architectural decision, its context, and consequences. |
| **Control Catalog** | A structured list of security or compliance controls (requirements) that an organization must implement. Examples: NIST 800-53, CIS Controls, or custom organizational controls. |
| **Evidence** | Documentation proving that a control is implemented. Examples: screenshots, configuration exports, audit logs, attestation letters. |
| **BAA** | Business Associate Agreement. Required under HIPAA when a vendor will handle Protected Health Information (PHI). Without a signed BAA, the tool cannot be used for HIPAA-regulated data. |

---

## ADR Documentation Platform Categories

The following categories describe types of tools for managing ADRs and compliance documentation. **No specific vendors are endorsed.** Evaluate any tool against your regulatory requirements before adoption.

### Category 1: Local-First / Self-Hosted

**What these are**: Tools that store data locally or on infrastructure you control. Data never leaves your environment unless you configure synchronization.

**Characteristics**:
- Full data control and sovereignty
- No third-party access to your documentation
- Typically free or low-cost
- Requires self-management of backups and access control
- Generally lack enterprise audit trails and compliance certifications

**Examples of this category**:
- Local markdown files in version-controlled repositories
- Self-hosted wiki software
- Desktop knowledge management applications with local storage
- CLI tools that generate ADRs as markdown files

**Best for**: Early-stage projects, privacy-conscious organizations, air-gapped environments, teams comfortable with self-management.

**Not suitable for**: Organizations requiring SOC 2 attestation of their documentation platform, HIPAA-regulated environments (no BAA possible), or teams needing enterprise access controls.

---

### Category 2: Collaborative Documentation Platforms

**What these are**: Cloud-hosted platforms for team documentation with collaboration features, permissions, and some audit capabilities.

**Characteristics**:
- Easy onboarding and collaboration
- Varying levels of access control
- Some offer SOC 2 Type II certification
- May or may not offer BAA for HIPAA
- Limited GRC integration

**Evaluation criteria before selection**:

| Question | Why It Matters |
|----------|----------------|
| Does the vendor have SOC 2 Type II? | Demonstrates security controls are audited |
| Does the vendor sign BAAs? | Required if storing any data that could be PHI-adjacent |
| What is the data residency? | May matter for data sovereignty requirements |
| Are audit logs available? | Needed to prove when decisions were made |
| Can you export all data? | Avoid vendor lock-in |

**Important**: Many popular collaboration tools in this category do **not** offer BAAs except on their highest-tier enterprise plans. Verify before storing any sensitive compliance documentation.

**Best for**: Growing teams, cross-functional collaboration, organizations without strict regulatory requirements.

**Not suitable for**: Financial services firms subject to SEC/FINRA examination without additional controls, HIPAA-covered entities (unless BAA confirmed), organizations requiring formal evidence chains.

---

### Category 3: Enterprise Content Management

**What these are**: Platforms designed for large organizations with formal records management, retention policies, and compliance features.

**Characteristics**:
- Formal records management capabilities
- Legal hold support
- Extensive compliance certifications (FedRAMP, HIPAA, etc.)
- Integration with enterprise identity providers
- Higher cost and implementation complexity

**Best for**: Large enterprises, government contractors, organizations with formal records retention requirements.

---

### Category 4: GRC Platforms

**What these are**: Governance, Risk, and Compliance platforms that treat documentation as formal compliance artifacts with evidence linkage, control mapping, and audit support.

**Characteristics**:
- Purpose-built for compliance programs
- Control libraries and framework mappings
- Evidence collection and linking
- Audit workflow support
- Typically require significant implementation effort
- Higher cost (often $50K-$500K+ annually)

**Important context for financial services**:

Many GRC platforms marketed to technology companies (focused on SOC 2, ISO 27001) are **not designed for financial services compliance**. Broker-dealers, investment advisers, and funds have specialized requirements:

- FINRA Rule 4511 (books and records)
- SEC Rule 17a-4 (electronic storage)
- SEC Rule 206(4)-7 (compliance programs for advisers)
- Investment Company Act requirements

**Financial services firms typically use**:
- Specialized compliance platforms built for RIA/BD workflows
- Communications archiving systems (for electronic communications supervision)
- Trade surveillance systems
- Regulatory filing systems

If you are a registered investment adviser, broker-dealer, or fund, consult with compliance counsel about appropriate tooling. Generic GRC platforms may not meet your specific regulatory requirements.

---

### Category 5: Large Enterprise / Consulting Engagement

**What these are**: For organizations with complex regulatory obligations, the "tool" is often not software but a consulting engagement with firms that specialize in compliance programs.

**Characteristics**:
- Major accounting/consulting firms offer GRC services
- Specialized compliance consulting firms (often former regulators)
- Custom implementations tailored to your regulatory profile
- Typically $500K-$2M+ annually for comprehensive programs
- May include managed services, not just software

**When this is appropriate**:
- Public companies with SOX obligations
- Firms under consent decrees or enhanced supervision
- Complex multi-jurisdictional regulatory requirements
- Organizations that have failed examinations and need remediation

**Reality check**: If your compliance budget is under $100K/year, this category is likely not for you. However, awareness that it exists helps calibrate expectations-the tools in Categories 1-4 are not substitutes for comprehensive compliance programs at regulated financial institutions.

---

## Selection Criteria

When evaluating any documentation or GRC platform:

| Criterion | Questions to Ask |
|-----------|------------------|
| **Audit Trail** | Does it maintain tamper-evident version history? Can you prove when decisions were made and by whom? |
| **Access Control** | Can you restrict who can view, edit, and approve? Does it support your identity provider? |
| **Compliance Certifications** | SOC 2 Type II? FedRAMP? Does it meet YOUR regulatory requirements? |
| **BAA Availability** | If you handle any health-adjacent data, can the vendor sign a BAA? |
| **Retention & Legal Hold** | Can you enforce retention policies? Support legal holds for litigation? |
| **Export & Portability** | Can you export all data in standard formats? What happens if the vendor shuts down? |
| **Financial Services Suitability** | If you're SEC/FINRA regulated, does this tool understand your requirements? |

---

## Recommended Approach

1. **Start with version-controlled markdown** for engineering-driven ADRs during development
2. **Evaluate collaboration platforms carefully** - verify compliance certifications match your needs
3. **For regulated financial services**: Consult compliance counsel before selecting any platform
4. **Maintain export capability** - always be able to extract documentation in portable formats
5. **Don't assume "enterprise" means "compliant for your use case"**

---

## Encryption Requirements Reminder

Regardless of platform choice, ensure:

- **Data in transit**: TLS 1.2 minimum, TLS 1.3 preferred. Many organizations are moving to TLS 1.3-only, but some legacy integrations may require 1.2. The key principle is: **all data must be encrypted in transit**.
- **Data at rest**: AES-256 encryption for stored data.
- **Key management**: Keys should be managed by a proper key management system (cloud provider KMS or hardware security module), not stored alongside the encrypted data.

---

## Why This Architecture May or May Not Fit Your Needs

### When this reference architecture is appropriate:

- Building a **new compliance evidence management system** from scratch
- Need to **link evidence to regulatory controls** with cryptographic verification
- Want **modular components** that can be swapped based on your cloud provider
- Building for **single-tenant deployment** (one organization's data)
- Have engineering capability to implement and maintain

### When you should look elsewhere:

- You need a **turnkey solution** today, not a reference architecture
- You're a **registered investment adviser or broker-dealer** and need FINRA/SEC-specific workflows - specialized vendors exist for this
- You need **communications archiving** (email, chat supervision) - that's a different product category entirely
- Your compliance team has **no engineering support** - you need a managed platform, not architecture docs
- You're under **regulatory examination pressure** - hire consultants, don't build

### Financial services-specific tooling categories (not covered here):

| Need | Tool Category |
|------|---------------|
| Electronic communications supervision | Communications archiving platforms |
| Trade surveillance | Trade monitoring systems |
| Form ADV / Form BD filings | Regulatory filing platforms |
| Investor onboarding / KYC | Investor verification platforms |
| CCO workflow management | RIA/BD compliance management platforms |

These are specialized tools built for financial services workflows. This reference architecture is for **custom compliance evidence management**, not a replacement for industry-specific platforms.
