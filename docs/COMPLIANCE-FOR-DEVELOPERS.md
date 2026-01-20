# Compliance for Developers: What You Need to Know

**Audience**: Developers, DevOps, IT teams who are building this system but don't have a finance or legal background.

**Read time**: 10 minutes

**Purpose**: Give you the context to understand WHY we're building things this way, so you can make good decisions when we haven't documented every edge case.

---

## The 30-Second Version

You're building a system that stores records for investment advisers. The government (SEC, FINRA) can show up and demand to see those records. If the records have been altered, deleted, or can't be produced, the adviser gets fined or loses their license. Your job is to make records **impossible to alter** and **easy to retrieve**.

---

## What the Hell Is a Security?

Not the kind you're thinking of. In finance, a "security" is an investment product:

| Security Type | What It Is | Example |
|---------------|------------|---------|
| Stock | Ownership in a company | Apple shares |
| Bond | Loan to a company/government | Treasury bonds |
| Fund | Pool of investments | Mutual fund, ETF |
| Investment contract | Promise of profits from others' efforts | Private equity, hedge fund interests |

**Why it matters**: Selling securities is heavily regulated. If you sell securities without following the rules, you go to jail. That's not an exaggeration.

---

## Who Are the Players?

### Investment Advisers (RIAs)

**What they do**: Manage money for clients. They decide what stocks/bonds/funds to buy for their clients' accounts.

**Scale**: Ranges from a solo person managing $50 million to firms managing $500 billion.

**Your users**: The compliance officers (CCOs) at these firms. They're responsible for proving the firm follows the rules.

### The SEC (Securities and Exchange Commission)

**What they do**: Federal regulator. Makes rules. Sends examiners to check if firms follow the rules. Fines or shuts down firms that don't.

**Their power**: They can show up with a subpoena and demand every record you have. Not "within 30 days" — now.

### FINRA (Financial Industry Regulatory Authority)

**What they do**: Self-regulatory organization for broker-dealers. Similar to SEC but for firms that execute trades.

**Their power**: Can fine firms, ban individuals from the industry, refer cases to SEC/DOJ for criminal prosecution.

---

## Why Records Matter

### The Examiner Scenario

Here's what actually happens:

1. SEC sends a letter: "We're coming to examine your firm next month"
2. Examiner shows up with a list of requests: "Show me all investor qualification documents for Fund XYZ from 2023"
3. Compliance officer has to produce those records
4. Examiner checks: Are records complete? Were they altered? Can you prove when they were created?

**If you can't produce records**: Fine, potentially lose license
**If records were altered**: Criminal referral possible

### What "Altered" Means

This isn't about malicious actors. Consider:

- Compliance officer accidentally uploads wrong version, then uploads correct version → That's an alteration
- Database admin runs UPDATE query to fix a typo → That's an alteration
- Backup restore replaces records → That's an alteration

**The rule is simple**: Once a record is created, it cannot change. Ever. For 7 years minimum.

---

## The Regulations (Plain English)

### SEC Rule 17a-4

**What it says**: Records must be stored in "non-rewritable, non-erasable" format.

**What it means**:
- No UPDATE statements
- No DELETE statements
- No overwriting files
- No "oops let me fix that"

**How we comply**: S3 Object Lock in COMPLIANCE mode. Once a file is uploaded, AWS literally cannot delete it until the retention period expires. Not "won't" — cannot. Even AWS support can't do it.

### FINRA Rule 4511

**What it says**: Firms must make and keep books and records required by law.

**What it means**:
- You have to actually create the records (not optional)
- You have to keep them for specific periods (6 years for most, 3 years for some)
- You have to be able to find them when asked

**How we comply**: Structured storage with indexing, retention policies, search capability.

### SEC Rule 206(4)-7

**What it says**: Investment advisers must have written compliance policies and a Chief Compliance Officer.

**What it means**: Firms need a system to prove they're following their own rules. That's what this software helps with.

---

## Evidence: What We're Actually Storing

"Evidence" in this context means proof that the firm followed the rules. Examples:

| Regulation | Evidence Required | What That Looks Like |
|------------|-------------------|---------------------|
| Accredited investor verification | Proof investor qualifies | Tax returns, CPA letters, brokerage statements |
| Anti-money laundering | Identity verification | ID scans, address verification |
| Trade allocation | Fair treatment of clients | Trade tickets, allocation records |
| Communications supervision | Review of client communications | Emails, chat logs, meeting notes |

**Key insight**: The evidence isn't just "we have a document." It's "we have a document, we can prove when it was created, we can prove it hasn't been altered, and we can prove who submitted it."

---

## Why Normal Databases Don't Work

### The Problem with PostgreSQL/MySQL/etc.

```sql
-- Any DBA can run this
UPDATE evidence SET document = 'altered_version.pdf' WHERE id = 123;

-- Or this
DELETE FROM evidence WHERE embarrassing = true;
```

Even with audit logging, you're logging that you *didn't* alter records. Regulators don't trust that. They want storage that *can't* be altered.

### The Solution: WORM Storage

**WORM** = Write Once, Read Many

```
You: "AWS, store this file for 7 years"
AWS: "Done. Object Lock enabled."

You: "Actually, delete that file"
AWS: "No."

You: "I'm the account owner, delete it"
AWS: "No."

You: "I'll call support"
AWS: "They can't either. See you in 7 years."
```

This is what regulators want. Not "we promise we won't delete it" — "we literally can't delete it."

---

## The Hash Chain: Why It Matters

### The Problem

Even with WORM storage, how do you prove the *sequence* of records? Someone could:
1. Create fake backdated records
2. Upload them to WORM storage
3. Claim they existed all along

### The Solution

Each record includes a hash of the previous record:

```
Record 1:
  data: "Investor A qualified on Jan 1"
  prev_hash: 0000000000
  hash: abc123

Record 2:
  data: "Investor B qualified on Jan 2"
  prev_hash: abc123  ← Must match Record 1's hash
  hash: def456

Record 3:
  data: "Investor C qualified on Jan 3"
  prev_hash: def456  ← Must match Record 2's hash
  hash: ghi789
```

**If anyone inserts a fake record between 1 and 2**:
- Fake record would need prev_hash = abc123
- Fake record would have hash = xyz999
- Record 2 still has prev_hash = abc123
- Now there's a conflict: two records claim to follow Record 1
- Tampering is mathematically detectable

### Why This Isn't Blockchain

"Hash chain" sounds like blockchain. It's not.

| Feature | Blockchain | Our Hash Chain |
|---------|------------|----------------|
| Distributed | Yes, thousands of nodes | No, single authority |
| Consensus | Mining/staking | Not needed (we're the authority) |
| Public | Usually | No, private records |
| Immutability source | Network consensus | WORM storage + hashes |

We don't need blockchain because we're not trying to achieve consensus among untrusting parties. We're trying to prove to regulators that WE didn't alter our OWN records. WORM storage + hash chains does that.

---

## The Merkle Tree: Efficient Verification

### The Problem

Examiner: "Prove record #47,832 hasn't been altered"

Bad answer: "Here's all 100,000 records, verify the entire hash chain"

### The Solution

Merkle tree lets you verify one record with O(log n) data:

```
                Root Hash (signed daily)
                /                \
          Hash(1-50000)      Hash(50001-100000)
          /        \              /        \
     Hash(1-25K)  Hash(25K-50K)  ...       ...
        ...         ...

Your record #47,832 is somewhere in here
```

To verify record #47,832, examiner only needs:
- The record itself
- ~17 hashes (log₂ of 100,000)
- The signed root hash

They can mathematically verify the record is part of the set without seeing any other records.

**Why this matters**: Privacy. Examiner can verify specific records without accessing unrelated client data.

---

## What You're Building (System Overview)

```
┌─────────────────────────────────────────────────────────────────┐
│                    WHAT USERS SEE                                │
│                                                                  │
│  Compliance Officer uploads investor qualification document      │
│                           │                                      │
│                           ▼                                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                    WHAT YOU BUILD                                │
│                                                                  │
│  1. Hash the document (SHA-256)                                  │
│  2. Create metadata record (who, what, when)                     │
│  3. Link to previous record (hash chain)                         │
│  4. Store document in WORM storage (S3 Object Lock)              │
│  5. Store metadata in PostgreSQL (for search)                    │
│  6. Add to Merkle tree (for efficient verification)              │
│  7. Return confirmation with proof of storage                    │
│                                                                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                    WHAT REGULATORS SEE                           │
│                                                                  │
│  "Show me proof this document existed on Jan 15, 2024"           │
│                           │                                      │
│                           ▼                                      │
│  System returns:                                                 │
│  - Original document (unchanged, from WORM storage)              │
│  - Timestamp of creation                                         │
│  - Hash proving document hasn't changed                          │
│  - Merkle proof showing it was part of the record set            │
│  - Signed checkpoint from that date                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Common Developer Questions

### "Can't the compliance officer just upload fake documents?"

Yes, but that's not our problem. We prove that *whatever was uploaded* hasn't changed since upload. If someone uploads fake documents, that's fraud — a legal problem, not a technical one.

Our job: Make it impossible to alter records after the fact.
Not our job: Verify the underlying truth of documents.

### "What if there's a bug and we need to fix data?"

You don't fix data. You create a new record that supersedes the old one. The old record still exists (WORM), but the new record references it and explains the correction.

```
Record 1: "Investor income: $200,000"
Record 2: "CORRECTION to Record 1: Income was $250,000. Error was typo."
```

Both records exist forever. Audit trail is preserved.

### "What about GDPR right to deletion?"

This is a genuine conflict. SEC requires 7-year retention; GDPR allows deletion requests.

**Current approach**:
- Document the regulatory conflict
- Anonymize records after retention period if legally required
- Consult legal counsel for specific cases

### "How do we handle backups?"

Backups of WORM storage are fine — you're copying immutable data. The concern is restore operations that might overwrite records.

**Rule**: Never restore over existing records. If you need to recover, recover to a separate location and reconcile.

### "What if AWS has an outage?"

Multi-region replication. Records exist in at least two AWS regions. If us-east-1 goes down, records are still in us-west-2.

### "What about cost? WORM storage forever sounds expensive."

It is. That's why we have tiered storage:
- Hot (S3 Standard): Recent records, frequently accessed
- Warm (S3 IA): Older records, occasional access
- Cold (S3 Glacier): Old records, rare access, still WORM

All tiers maintain immutability. Cost goes from ~$0.023/GB/month to ~$0.004/GB/month.

---

## The Stakes

This isn't academic. Real consequences:

| Violation | Consequence |
|-----------|-------------|
| Can't produce records | Fine ($10K-$500K+), enhanced supervision |
| Records were altered | Criminal referral, industry ban |
| Repeated violations | Firm shutdown, personal liability for CCO |

Your users' careers depend on this system working correctly. The compliance officer who can't produce records during an exam may lose their job. The one whose records were altered may face criminal charges.

---

## Key Takeaways for Development

1. **Never update, always append**: Any "correction" is a new record referencing the old one
2. **Hash everything**: Every record gets SHA-256 hashed, stored with the record
3. **WORM is non-negotiable**: If it's not in Object Lock COMPLIANCE mode, it doesn't count
4. **Timestamps matter**: Use server time, not client time. Millisecond precision.
5. **Log who did what**: Every action tied to authenticated user
6. **Test retrieval**: Fast write means nothing if you can't retrieve during an exam
7. **Plan for 7 years**: Your code will be gone. Your records must survive.

---

## Further Reading

| Document | What You'll Learn |
|----------|-------------------|
| [IT-SECURITY-TECHNICAL-BUILD-GUIDE.md](IT-SECURITY-TECHNICAL-BUILD-GUIDE.md) | Detailed security implementation specs |
| [storage-compliance.md](architecture/storage-compliance.md) | WORM storage configuration |
| [evidence-locker.md](architecture/evidence-locker.md) | Database schema and API design |
| [DEVELOPMENT-PLAN.md](DEVELOPMENT-PLAN.md) | Cost tiers and implementation phases |

---

## Glossary

| Term | Plain English |
|------|---------------|
| **AUM** | Assets Under Management. Total money the firm manages. |
| **CCO** | Chief Compliance Officer. The person responsible for following rules. |
| **Examination** | Regulators showing up to check your records. |
| **Evidence** | Documents proving you followed the rules. |
| **FINRA** | Regulator for broker-dealers. Can fine and ban people. |
| **RIA** | Registered Investment Adviser. Firm that manages money for clients. |
| **SEC** | Securities and Exchange Commission. Federal regulator. Makes rules, sends examiners, files lawsuits. |
| **Security** | Investment product (stock, bond, fund). Not cybersecurity. |
| **WORM** | Write Once Read Many. Storage that can't be altered. |
| **17a-4** | SEC rule requiring immutable electronic records. The whole reason we use WORM storage. |
