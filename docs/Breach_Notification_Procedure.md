# Breach Notification Procedure

**Application:** FullVision — Learning Profile Builder and Communicator
**Developer:** Colin Brown (brown_colin@surreyschools.ca)
**District:** Surrey School District
**Date:** March 22, 2026
**Version:** 1.0

---

## 1. Definition of a Breach

A privacy breach occurs when personal information is collected, used, disclosed, or disposed of in ways that are not authorized. For the purposes of this application, a breach includes any of the following:

- **Unauthorized access:** A person gains access to student or teacher data without permission (e.g., compromised login credentials, exploitation of a software vulnerability).
- **Data exposure:** Student or teacher data is unintentionally made available to unauthorized individuals (e.g., a misconfigured database, accidental public exposure of records).
- **Data loss:** Student or teacher data is lost and cannot be recovered (e.g., database corruption without viable backup, accidental deletion of infrastructure).
- **System compromise:** The application, database, or hosting infrastructure is compromised by a malicious actor (e.g., injection attack, unauthorized API key usage).

---

## 2. Detection

Breaches may be detected through the following channels:

### Automated Monitoring

| Monitoring Source | What It Detects |
|---|---|
| Supabase Auth logs | Failed login attempts, unusual login patterns, account lockouts |
| Supabase API logs | Unusual query patterns, unauthorized API requests, elevated error rates |
| Supabase dashboard alerts | Infrastructure issues, service disruptions |

### Human Reporting

- **Teachers** may report suspicious activity, such as unexpected changes to their data, inability to log in, or unfamiliar activity in their account.
- **The developer** may identify vulnerabilities during code review, dependency updates, or routine security checks.

Teachers should report any suspected breach immediately to the developer at **brown_colin@surreyschools.ca**.

---

## 3. Immediate Response (0-4 Hours)

Upon detection or report of a suspected breach, the following steps are taken immediately:

### Step 1: Identify the Scope

- Determine what type of breach has occurred (unauthorized access, data exposure, data loss, or system compromise).
- Identify which systems are affected (authentication, database, hosting).
- Estimate how many users and records may be affected.

### Step 2: Contain the Breach

- **Disable affected teacher accounts** to prevent further unauthorized access.
- **Rotate API keys and database credentials** if there is any indication they have been compromised.
- **Revoke active sessions** for affected accounts.
- **Take affected services offline** if necessary to prevent further data exposure.

### Step 3: Preserve Evidence

- **Save copies of relevant logs** (authentication logs, API logs, error logs) before any log rotation or expiry.
- **Document the timeline** of events as known at this stage.
- **Do not modify or delete** any data related to the breach until the assessment is complete.

---

## 4. Assessment (4-24 Hours)

### Determine What Happened

- Review authentication and API logs to identify the method and duration of unauthorized access.
- Identify the specific data that was accessed, exposed, or lost (e.g., which students, which courses, what types of records).

### Identify Affected Users

- Determine which teacher accounts were affected.
- Determine which students' records were potentially accessed or exposed.
- Compile a list of affected individuals for notification purposes.

### Assess Risk to Individuals

| Question | Consideration |
|---|---|
| What type of data was involved? | Names and grades carry different risk than student numbers or designations |
| Was the data actually viewed or downloaded? | Access without exfiltration is lower risk |
| Is the data usable by the unauthorized party? | Encrypted data that was not decrypted is lower risk |
| How many individuals are affected? | Scope affects notification approach |
| Is there an ongoing risk? | Has the vulnerability been closed? |

---

## 5. Notification (Within 72 Hours)

Under FOIPPA, the relevant authorities and affected individuals must be notified without unreasonable delay. The target is notification **within 72 hours** of confirming a breach.

### Who Is Notified

| Recipient | Method | Responsibility |
|---|---|---|
| Surrey School District Privacy Officer | Email and phone | Developer notifies directly |
| Affected teachers | Email | Developer notifies directly |
| Parents and guardians of affected students | Per district protocol | District notifies (not the developer) |
| BC Office of the Information and Privacy Commissioner | Per district protocol | District notifies if required |

### What the Notification Includes

Notifications to the district and affected teachers will include:

- A description of what happened
- The date and time the breach was discovered
- The type of personal information involved
- The number of individuals affected
- What steps have been taken to contain the breach
- What steps are being taken to prevent future occurrences
- Contact information for questions

### Documentation

A written breach report will be prepared and provided to the district Privacy Officer, including:

- Full timeline of the incident
- Description of the data involved
- Root cause analysis
- Containment and remediation actions taken
- Recommendations for preventing recurrence

---

## 6. Remediation

### Fix the Vulnerability

- Identify and resolve the root cause of the breach (e.g., patch software, fix configuration, update dependencies).
- Verify the fix through testing before restoring normal operations.

### Credential and Access Reset

- **Force password resets** for all affected teacher accounts if credentials were or may have been compromised.
- **Rotate all API keys and secrets** associated with the application and database.
- **Review and tighten Row-Level Security policies** if the breach involved cross-account data access.

### Security Improvements

- Update security measures based on lessons learned from the breach.
- Review and update dependencies to address known vulnerabilities.
- Consider additional monitoring or alerting if the breach revealed gaps in detection.

### Post-Incident Review

Within 30 days of the breach, conduct a post-incident review that includes:

- What happened and why
- How the breach was detected
- How effectively the response plan worked
- What changes are needed to prevent similar incidents
- Updates to this procedure, if warranted

---

## 7. Contact Information

### Application Developer

| | |
|---|---|
| **Name** | Colin Brown |
| **Email** | brown_colin@surreyschools.ca |
| **Role** | Developer and maintainer of FullVision |

### Supabase Security

| | |
|---|---|
| **Email** | security@supabase.io |
| **Purpose** | Report security issues with the Supabase platform |

### BC Office of the Information and Privacy Commissioner

| | |
|---|---|
| **Website** | [https://www.oipc.bc.ca](https://www.oipc.bc.ca) |
| **Phone** | 250-387-5629 |
| **Purpose** | Oversight body for FOIPPA compliance in BC |

### Surrey School District

| | |
|---|---|
| **Contact** | District Privacy Officer (contact via district office) |
| **Purpose** | District-level breach notification and coordination |

---

**Prepared by:** Colin Brown
**Contact:** brown_colin@surreyschools.ca
**Date:** March 22, 2026
