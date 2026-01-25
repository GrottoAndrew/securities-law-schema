# ADR-003: Compliance Framework Alignment

**Status**: Accepted
**Date**: 2026-01-19
**Deciders**: Architecture Team, Legal, Compliance
**Consulted**: Security, Operations, External Counsel

## Context

The compliance management system handles sensitive financial and investor data subject to multiple overlapping regulatory frameworks. Organizations deploying this system may need to demonstrate compliance with various combinations of:

- **Cybersecurity Frameworks**: NIST CSF 2.0
- **AI/ML Governance**: ISO/IEC 42001, NIST AI RMF, EU AI Act
- **Financial Regulations**: SEC, FINRA, ABA Model Rules
- **Industry Standards**: SOC 2 Type II, PCI DSS 4.0
- **Government**: FedRAMP, HIPAA, CJIS
- **Privacy**: GDPR, CCPA/CPRA

This ADR documents how the system architecture aligns with these frameworks and provides a compliance matrix for implementers.

## Decision

We adopt a **compliance-by-design** approach with architecture decisions explicitly mapped to regulatory controls. The system is designed to meet the union of requirements across all targeted frameworks, enabling organizations to claim compliance with any subset.

---

## Framework Alignment Matrix

### NIST Cybersecurity Framework 2.0

The system addresses all five core functions:

#### GOVERN (GV)

| Control | Implementation |
|---------|----------------|
| GV.OC-01: Organizational context | Documented in deployment configuration |
| GV.RM-01: Risk management | Threat model documented, risk register maintained |
| GV.SC-01: Supply chain risk | Dependency scanning, vendor security reviews |
| GV.PO-01: Cybersecurity policy | Policy-as-code in access control configurations |

#### IDENTIFY (ID)

| Control | Implementation |
|---------|----------------|
| ID.AM-01: Hardware inventory | Infrastructure-as-code defines all assets |
| ID.AM-02: Software inventory | SBOM generation for all components |
| ID.AM-03: Network mapping | Architecture diagrams, network flow documentation |
| ID.RA-01: Vulnerabilities identified | Automated vulnerability scanning |
| ID.RA-02: Threat intelligence | Security advisories monitoring |

#### PROTECT (PR)

| Control | Implementation |
|---------|----------------|
| PR.AA-01: Identity management | SSO integration, MFA required |
| PR.AA-02: Authentication | Certificate-based for services, MFA for users |
| PR.AA-03: Access control | RBAC with least privilege (see ADR-002) |
| PR.DS-01: Data-at-rest protection | AES-256 encryption for all stores |
| PR.DS-02: Data-in-transit protection | TLS 1.3 mandatory (see ADR-001, ADR-002) |
| PR.DS-10: Data integrity | Merkle tree verification, hash chains |
| PR.PS-01: Configuration management | Immutable infrastructure, GitOps |
| PR.PS-02: Software maintenance | Automated patching, dependency updates |

#### DETECT (DE)

| Control | Implementation |
|---------|----------------|
| DE.CM-01: Network monitoring | VPC flow logs, IDS/IPS |
| DE.CM-03: Computing activity | Host-based monitoring, audit logging |
| DE.CM-06: External service activity | API access logging, third-party monitoring |
| DE.AE-02: Event analysis | SIEM integration, anomaly detection |

#### RESPOND (RS)

| Control | Implementation |
|---------|----------------|
| RS.MA-01: Incident management | Documented playbooks, on-call rotation |
| RS.AN-03: Incident analysis | Forensic logging, evidence preservation |
| RS.MI-01: Incident containment | Automated isolation capabilities |
| RS.MI-02: Incident mitigation | Rollback procedures, kill switches |

#### RECOVER (RC)

| Control | Implementation |
|---------|----------------|
| RC.RP-01: Recovery planning | DR plan documented and tested |
| RC.RP-02: Recovery execution | Automated recovery procedures |
| RC.CO-03: Recovery communication | Stakeholder notification procedures |

---

### AI/ML Compliance Frameworks

#### ISO/IEC 42001 (AI Management System)

| Requirement | Implementation |
|-------------|----------------|
| 5.2 AI Policy | AI use policy documented in `docs/ai-policy.md` |
| 6.1.2 Risk Assessment | AI-specific risks in threat model |
| 7.2 Competence | Training requirements for AI system operators |
| 8.2 AI System Design | Documented AI decision points (if any) |
| 8.4 Data Management | Data lineage, quality controls for training data |
| 9.1 Monitoring | Model performance monitoring, drift detection |
| 9.2 Internal Audit | AI system audit procedures |

#### NIST AI Risk Management Framework

| Function | Implementation |
|----------|----------------|
| GOVERN 1.1: Legal compliance | Regulatory mapping (this document) |
| MAP 1.1: Intended purpose | AI use cases documented |
| MAP 1.5: Risk assessment | AI risk register |
| MEASURE 2.1: Performance | Accuracy, fairness metrics |
| MANAGE 3.1: Risk response | Mitigation controls documented |

#### EU AI Act Considerations

If deploying in EU or processing EU data:

| Requirement | Implementation |
|-------------|----------------|
| Risk Classification | System classified per Article 6 criteria |
| Data Governance | Article 10 compliance for training data |
| Documentation | Technical documentation per Article 11 |
| Transparency | User notification requirements |
| Human Oversight | Human-in-the-loop for high-risk decisions |
| Accuracy/Robustness | Testing and validation procedures |

---

### Financial Industry Regulations

#### SEC (Securities and Exchange Commission)

| Rule | Implementation |
|------|----------------|
| **Rule 17a-4** (Record retention) | |
| 17a-4(f)(2)(ii)(A) | WORM storage compliance via Object Lock |
| 17a-4(f)(3)(v) | Audit trail, verification capability |
| **Regulation S-P** (Privacy) | |
| Rule 30 | Safeguards for customer information |
| **Regulation S-ID** (Identity theft) | |
| Red Flags Rule | Identity verification controls |

#### FINRA (Financial Industry Regulatory Authority)

| Rule | Implementation |
|------|----------------|
| **Rule 4511** (Books and records) | |
| 4511(a) | Record creation and maintenance |
| 4511(b) | Retention periods (6 years general, 3 years correspondence) |
| 4511(c) | Format requirements |
| **Rule 3110** (Supervision) | |
| 3110(a) | Written supervisory procedures |
| 3110(b)(4) | Review of correspondence |

#### ABA Model Rules (Legal Ethics)

For law firm deployments:

| Rule | Implementation |
|------|----------------|
| **Rule 1.1** (Competence) | Training materials, competency requirements |
| **Rule 1.6** (Confidentiality) | Encryption, access controls, audit trails |
| **Rule 5.3** (Non-lawyer assistance) | Supervision controls for AI systems |

---

### Industry Standards

#### SOC 2 Type II

| Trust Service Criteria | Implementation |
|------------------------|----------------|
| **Security (Common Criteria)** | |
| CC1.1: COSO principle 1 | Integrity and ethical values documented |
| CC2.1: Internal communication | Security policies communicated |
| CC3.1: Risk assessment | Annual risk assessment |
| CC4.1: Monitoring activities | Continuous monitoring implemented |
| CC5.1: Control activities | Controls documented and tested |
| CC6.1: Logical access security | RBAC, MFA, audit logging |
| CC6.2: Access provisioning | Onboarding/offboarding procedures |
| CC6.3: Access removal | Automated deprovisioning |
| CC6.6: External threats | WAF, DDoS protection, vulnerability scanning |
| CC6.7: Information transmission | TLS 1.3 mandatory |
| CC7.1: Vulnerability management | Automated scanning, patch management |
| CC7.2: Incident detection | SIEM, alerting, monitoring |
| CC7.3: Incident response | Documented playbooks |
| CC7.4: Incident recovery | DR procedures |
| CC8.1: Change management | GitOps, approval workflows |
| CC9.1: Risk mitigation | Controls mapped to risks |
| **Availability** | |
| A1.1: Availability commitment | SLA documented (Level 3) |
| A1.2: System recovery | RTO/RPO defined, tested |
| **Processing Integrity** | |
| PI1.1: Quality objectives | Data validation, hash verification |
| **Confidentiality** | |
| C1.1: Confidential information | Data classification implemented |
| C1.2: Confidential information disposal | Secure deletion procedures |
| **Privacy** | |
| P1-P8: Privacy criteria | See Privacy section below |

#### PCI DSS 4.0

For deployments handling payment card data:

| Requirement | Implementation |
|-------------|----------------|
| **Req 1: Network security** | Network segmentation, firewalls |
| **Req 2: Secure configurations** | CIS benchmarks, hardened images |
| **Req 3: Account data protection** | Encryption at rest (AES-256) |
| **Req 4: Transmission encryption** | TLS 1.3 mandatory |
| **Req 5: Malware protection** | Endpoint protection, scanning |
| **Req 6: Secure development** | SSDLC, code review, SAST/DAST |
| **Req 7: Access restriction** | Need-to-know, RBAC |
| **Req 8: User identification** | Unique IDs, MFA, strong passwords |
| **Req 9: Physical security** | Data center certifications |
| **Req 10: Audit logging** | Comprehensive logging, 1-year retention |
| **Req 11: Security testing** | Penetration testing, vulnerability scans |
| **Req 12: Policies** | Security policy documentation |

---

### Government Frameworks

#### FedRAMP (Federal Risk and Authorization Management Program)

| Control Family | Implementation Notes |
|----------------|---------------------|
| **AC - Access Control** | See RBAC implementation |
| **AU - Audit & Accountability** | Comprehensive audit logging |
| **CA - Assessment & Authorization** | Continuous monitoring |
| **CM - Configuration Management** | Infrastructure-as-code |
| **CP - Contingency Planning** | DR/BCP documented |
| **IA - Identification & Authentication** | MFA, certificate auth |
| **IR - Incident Response** | Documented procedures |
| **MA - Maintenance** | Patching procedures |
| **MP - Media Protection** | Encryption, secure disposal |
| **PE - Physical & Environmental** | Cloud provider certifications |
| **PL - Planning** | Security planning |
| **PM - Program Management** | Security program documented |
| **PS - Personnel Security** | Background checks, training |
| **RA - Risk Assessment** | Annual assessment |
| **SA - System & Services Acquisition** | SDLC security |
| **SC - System & Communications Protection** | TLS, encryption, network security |
| **SI - System & Information Integrity** | Vulnerability management, monitoring |
| **SR - Supply Chain Risk Management** | Vendor security reviews |

**Authorization Level Support**:
- Low: Fully supported
- Moderate: Fully supported
- High: Supported with appropriate deployment configuration

#### HIPAA (Health Insurance Portability and Accountability Act)

For deployments with PHI:

| Rule | Safeguard | Implementation |
|------|-----------|----------------|
| **Security Rule** | | |
| §164.308 | Administrative | Policies, training, risk analysis |
| §164.310 | Physical | Cloud provider controls, facility security |
| §164.312(a)(1) | Access Control | Unique user IDs, automatic logoff |
| §164.312(b) | Audit Controls | Comprehensive audit logging |
| §164.312(c)(1) | Integrity | Hash verification, Merkle trees |
| §164.312(d) | Person Authentication | MFA, certificate authentication |
| §164.312(e)(1) | Transmission Security | TLS 1.3 mandatory |
| **Privacy Rule** | | |
| §164.502 | Permitted Uses | Access controls limit data use |
| §164.514 | De-identification | De-identification procedures documented |
| **Breach Notification** | | |
| §164.400-414 | Breach procedures | Incident response includes notification |

#### CJIS (Criminal Justice Information Services)

For law enforcement deployments:

| Policy Area | Implementation |
|-------------|----------------|
| **5.1 Information Exchange** | Secure transmission documented |
| **5.4 Auditing and Accountability** | Comprehensive audit logging |
| **5.5 Access Control** | RBAC, background checks required |
| **5.6 Identification and Authentication** | MFA required, session management |
| **5.10.1 Encryption** | |
| 5.10.1.2.1 | AES-256 for data at rest |
| 5.10.1.2.2 | TLS 1.3 for data in transit |
| **5.12 Personnel Security** | Background investigation requirements |
| **5.13 Mobile Devices** | MDM requirements if applicable |

---

### Privacy Regulations

#### GDPR (General Data Protection Regulation)

| Article | Implementation |
|---------|----------------|
| **Art. 5** (Principles) | |
| 5(1)(a) Lawfulness | Legal basis documented per processing activity |
| 5(1)(b) Purpose limitation | Purpose documented, enforced by access controls |
| 5(1)(c) Data minimization | Only necessary data collected |
| 5(1)(d) Accuracy | Data validation, correction procedures |
| 5(1)(e) Storage limitation | Retention policies, automated deletion |
| 5(1)(f) Integrity/confidentiality | Encryption, access controls |
| **Art. 17** (Right to erasure) | Deletion workflow, audit trail exemption documented |
| **Art. 20** (Portability) | Export functionality |
| **Art. 25** (Privacy by design) | Privacy integrated into architecture |
| **Art. 32** (Security) | Technical and organizational measures |
| **Art. 33** (Breach notification) | 72-hour notification procedures |
| **Art. 35** (DPIA) | DPIA template provided |

#### CCPA/CPRA (California Consumer Privacy Act)

| Right | Implementation |
|-------|----------------|
| Right to Know | Data inventory, access request workflow |
| Right to Delete | Deletion workflow, exceptions documented |
| Right to Correct | Data correction procedures |
| Right to Opt-Out | Consent management |
| Right to Limit Use | Purpose limitation controls |

---

## Implementation Requirements

### Mandatory for All Deployments

```yaml
baseline_requirements:
  encryption:
    at_rest: "AES-256"
    in_transit: "TLS 1.3"
    key_management: "HSM or managed KMS"

  authentication:
    users: "MFA required"
    services: "mTLS or API keys + TLS"

  authorization:
    model: "RBAC with least privilege"
    review: "Quarterly access reviews"

  audit_logging:
    coverage: "All security-relevant events"
    retention: "7 years minimum"
    integrity: "Hash chain or equivalent"

  incident_response:
    plan: "Documented and tested"
    notification: "Per applicable regulations"

  vulnerability_management:
    scanning: "Weekly minimum"
    patching: "Critical: 24h, High: 7d, Medium: 30d"

  backup_recovery:
    frequency: "Daily minimum"
    testing: "Quarterly DR tests"
    retention: "90 days minimum"
```

### Framework-Specific Overlays

Depending on applicable frameworks, additional controls may be required:

```yaml
overlays:
  fedramp_high:
    additional_controls:
      - "FIPS 140-2 validated cryptography"
      - "PIV authentication for privileged users"
      - "Continuous monitoring"

  pci_dss:
    additional_controls:
      - "Network segmentation for CDE"
      - "Quarterly ASV scans"
      - "Annual penetration testing"

  hipaa:
    additional_controls:
      - "BAA with all vendors"
      - "PHI access logging"
      - "Minimum necessary enforcement"

  cjis:
    additional_controls:
      - "Background investigations"
      - "Advanced authentication"
      - "Encryption for CJI"

  gdpr:
    additional_controls:
      - "Data Protection Impact Assessment"
      - "Records of processing activities"
      - "Data subject request workflows"
```

---

## Compliance Documentation

> **Note**: The paths below are templates for production deployments. These files do not exist in this repository - organizations implementing this system should create them.

The following documentation should be maintained for compliance evidence:

| Document | Location | Update Frequency |
|----------|----------|------------------|
| Security Policy | `docs/compliance/security-policy.md` | Annual |
| Risk Assessment | `docs/compliance/risk-assessment.md` | Annual |
| System Security Plan | `docs/compliance/ssp.md` | Annual + changes |
| Incident Response Plan | `docs/compliance/irp.md` | Annual |
| Business Continuity Plan | `docs/compliance/bcp.md` | Annual |
| Data Classification | `docs/compliance/data-classification.md` | Annual |
| Vendor Management | `docs/compliance/vendor-management.md` | Annual |
| Privacy Impact Assessment | `docs/compliance/pia.md` | Per system change |
| Audit Log Procedures | `docs/compliance/audit-procedures.md` | Annual |
| Penetration Test Reports | `docs/compliance/pentest/` | Annual |

---

## Consequences

### Positive
- Single architecture supports multiple compliance frameworks
- Clear mapping enables gap analysis
- Reduces duplicate controls across frameworks
- Enables multi-tenant deployments with different compliance needs

### Negative
- Complexity of managing multiple framework mappings
- Must implement superset of controls (higher cost)
- Requires compliance expertise to maintain mappings

### Risks
- Framework updates may require architecture changes
- Interpretation differences between auditors
- Regional variations in framework applicability

---

## Maintenance

This ADR and compliance mappings must be reviewed:
- Annually at minimum
- When any referenced framework is updated
- When significant architecture changes occur
- After any compliance audit findings

---

## References

### Standards and Frameworks
- [NIST CSF 2.0](https://www.nist.gov/cyberframework)
- [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework)
- [ISO/IEC 42001:2023](https://www.iso.org/standard/81230.html)
- [SOC 2](https://www.aicpa.org/soc2)
- [PCI DSS 4.0](https://www.pcisecuritystandards.org/)
- [FedRAMP](https://www.fedramp.gov/)
- [HIPAA](https://www.hhs.gov/hipaa/)
- [CJIS Security Policy](https://www.fbi.gov/services/cjis/cjis-security-policy-resource-center)

### Financial Regulations
- [SEC Rule 17a-4](https://www.sec.gov/rules/interp/34-47806.htm)
- [FINRA Rule 4511](https://www.finra.org/rules-guidance/rulebooks/finra-rules/4511)
- [ABA Model Rules](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/)

### Privacy
- [GDPR](https://gdpr.eu/)
- [CCPA/CPRA](https://oag.ca.gov/privacy/ccpa)

### AI Governance
- [EU AI Act](https://artificialintelligenceact.eu/)
- [NIST AI RMF Playbook](https://airc.nist.gov/AI_RMF_Knowledge_Base/Playbook)
