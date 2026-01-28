# Security Policy

## For this Repo

please email 'ops@irongrotto.com' or message the author if you find any issues.

Below is generally an outline of what we think security policy should be if you plan to BYOC and fork.

We follow similar for the repo itself but, this is largely explanatory for your benefit. We kindly ask you treat these guidlines as applicable to the repo if you find any issues to bring to our attention.

Email 'ops@irongrotto.com' for any reporting or security concerns.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please follow these steps:

### DO NOT

- Open a public GitHub issue
- Discuss the vulnerability in public forums
- Exploit the vulnerability beyond what is necessary to demonstrate it

### DO

1. **Email** security concerns to: `ops@irongrotto.com` \***\*Replace with your own email address for forked builds\*\***
2. **Include** in your report:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested remediation (if known)

### Response Timeline

| Action             | Timeline                    |
| ------------------ | --------------------------- |
| Acknowledgment     | Within 24 hours             |
| Initial assessment | Within 72 hours             |
| Status update      | Every 7 days                |
| Resolution target  | 90 days (critical: 30 days) |

## Security Architecture

### Data Protection

| Layer                  | Control              | Implementation                 |
| ---------------------- | -------------------- | ------------------------------ |
| **At Rest**            | AES-256 encryption   | AWS KMS managed keys           |
| **In Transit**         | TLS 1.3              | ALB termination, mTLS internal |
| **Evidence Artifacts** | WORM storage         | S3 Object Lock COMPLIANCE mode |
| **Audit Trail**        | Immutable hash chain | SHA-256 linked entries         |

### Authentication & Authorization

| Component              | Implementation                      |
| ---------------------- | ----------------------------------- |
| **Authentication**     | JWT tokens with RSA-256 signing     |
| **Authorization**      | Role-based access control (RBAC)    |
| **Session Management** | Token expiry, refresh rotation      |
| **MFA**                | Required for admin/compliance roles |

### Role Definitions

| Role         | Permissions                             |
| ------------ | --------------------------------------- |
| `admin`      | Full system access                      |
| `compliance` | Evidence submission, control management |
| `viewer`     | Read-only access to dashboard           |
| `auditor`    | Time-limited read access with export    |
| `system`     | Automated processes only                |

## Compliance Frameworks

This system is designed to support compliance with:

| Framework           | Key Requirements                            |
| ------------------- | ------------------------------------------- |
| **SEC Rule 17a-4**  | 7-year retention, WORM storage, audit trail |
| **FINRA Rule 4511** | Books and records preservation              |
| **SOC 2 Type II**   | Security, availability, confidentiality     |
| **NIST CSF**        | Identify, Protect, Detect, Respond, Recover |

## Security Checklist for Deployment

### Pre-Production

- [ ] All default credentials changed
- [ ] JWT secret is cryptographically random (32+ bytes)
- [ ] Database credentials rotated
- [ ] SSL/TLS certificates valid and not self-signed
- [ ] Rate limiting configured
- [ ] CORS origins restricted to known domains
- [ ] Logging to secure, centralized location
- [ ] Backup encryption enabled
- [ ] Penetration test completed

### Infrastructure

- [ ] VPC with private subnets for database
- [ ] Security groups follow least-privilege
- [ ] No public S3 buckets
- [ ] KMS key rotation enabled
- [ ] CloudTrail logging enabled
- [ ] GuardDuty monitoring active

### Application

- [ ] Input validation on all endpoints
- [ ] SQL injection protection (parameterized queries)
- [ ] XSS protection (Content Security Policy)
- [ ] CSRF protection (token validation)
- [ ] Dependency vulnerabilities addressed

## Incident Response

### Severity Levels

| Level           | Definition                                     | Response Time |
| --------------- | ---------------------------------------------- | ------------- |
| **P1 Critical** | Active data breach, system compromise          | 15 minutes    |
| **P2 High**     | Exploitable vulnerability, data exposure risk  | 1 hour        |
| **P3 Medium**   | Security weakness, limited exposure            | 24 hours      |
| **P4 Low**      | Best practice deviation, hardening opportunity | 1 week        |

### Contact Chain

1. Security Team Lead
2. Engineering Manager
3. CISO
4. Legal Counsel
5. Regulatory Affairs

## Audit Trail Requirements

Every action that modifies data must be logged with:

```json
{
  "timestamp": "ISO-8601",
  "action": "EVIDENCE_SUBMITTED | CONTROL_MODIFIED | USER_ACCESS | ...",
  "actor": "user@domain.com",
  "resource": "evidence:uuid | control:id",
  "details": {},
  "previousHash": "sha256:...",
  "currentHash": "sha256:..."
}
```

## Third-Party Security

| Vendor     | Purpose        | Security Review                              |
| ---------- | -------------- | -------------------------------------------- |
| AWS        | Infrastructure | SOC 2, ISO 27001, FedRAMP                    |
| Anthropic  | LLM (Claude)   | Model card review, data processing agreement |
| PostgreSQL | Database       | Open source audit                            |

## Security Updates

Security patches are applied:

- **Critical**: Within 24 hours
- **High**: Within 7 days
- **Medium**: Within 30 days
- **Low**: Next release cycle

---

_Last Updated: 2026-01-21_
_Version: 1.0.0_
