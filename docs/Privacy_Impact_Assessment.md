# Privacy Impact Assessment

**Application:** FullVision — Learning Profile Builder and Communicator
**Developer:** Colin Brown (brown_colin@surreyschools.ca)
**District:** Surrey School District
**Date:** March 22, 2026
**Version:** 1.0

---

## 1. Project Overview

FullVision is a web-based learning profile builder and communicator designed for teachers in British Columbia. It allows teachers to record student achievement against BC curriculum competencies, track learner dispositions, and generate reports aligned with BC's proficiency-based reporting requirements.

**Purpose:** To provide BC teachers with a simple, purpose-built tool for standards-based assessment and reporting, replacing ad hoc spreadsheets and paper records.

**Users:** Teachers in BC schools. There are no student or parent accounts. Only teachers interact with the application.

**How it works:** Teachers log in with an email and password, create courses, add students, define learning standards, and record assessment scores and observations. Reports can be generated and printed directly from the browser.

---

## 2. Personal Information Inventory

### Information Collected

| Data Element | Category | Purpose |
|---|---|---|
| Student first and last name | Personal identifier | Identify students in the gradebook |
| Preferred pronouns | Personal identifier | Respectful communication in reports |
| Student number | Personal identifier | Cross-reference with district systems |
| Date of birth | Personal identifier | Age-appropriate grouping, report generation |
| Designations (e.g., IEP, ELL) | Educational | Inform instructional planning |
| Course enrollment | Educational | Organize students by class |
| Assessment scores (proficiency levels) | Educational | Track achievement against standards |
| Teacher observations and comments | Educational | Narrative feedback for reporting |
| Learner disposition ratings | Educational | Track approaches to learning |

### Information NOT Collected

The application does not collect:

- Social Insurance Numbers (SIN)
- Health or medical records
- Home addresses or phone numbers
- Parent or guardian contact information
- Photographs or biometric data
- Behavioural or disciplinary records
- Financial information
- IP addresses or device identifiers for tracking purposes

### Teacher Information Collected

| Data Element | Purpose |
|---|---|
| Email address | Authentication and account recovery |
| Password (hashed) | Authentication |

---

## 3. Data Flow

All data flows through encrypted connections. No data is sent to third-party services.

```
Teacher's Browser
    |
    | HTTPS (TLS 1.3)
    |
    v
Netlify (Static Hosting)
    - Serves HTML, CSS, and JavaScript files only
    - No server-side processing
    - No data stored on Netlify
    |
    | HTTPS (TLS 1.3)
    |
    v
Supabase (Database & Authentication)
    - Region: AWS ca-central-1 (Montreal, Canada)
    - PostgreSQL database
    - Authentication service
    - Row-Level Security enforced
    |
    v
Data at Rest
    - AES-256 encryption
    - Automated daily backups
```

**What does NOT happen:**

- No data is sent to analytics services (no Google Analytics, no Mixpanel, etc.)
- No advertising networks receive data
- No cookies are used beyond the authentication session token
- No third-party JavaScript trackers are loaded
- No data leaves Canada

---

## 4. Authority for Collection

The collection of student personal information is authorized under:

- **BC School Act (RSBC 1996, c. 412):** Teachers are responsible for assessing and evaluating student progress, which requires maintaining records of student achievement.
- **BC Ministry of Education Reporting Order:** Teachers are required to report on student progress in relation to provincial curriculum standards, necessitating the collection and organization of assessment data.
- **Professional responsibility:** Under the BC Teachers' Council Standards for Educators, teachers are expected to maintain accurate records of student learning to inform instruction and communicate with families.

The information collected is limited to what is necessary for the purpose of educational assessment and reporting.

---

## 5. Data Storage

### Primary Storage

| Attribute | Detail |
|---|---|
| Provider | Supabase (built on AWS infrastructure) |
| Region | ca-central-1 (Montreal, Quebec, Canada) |
| Database | PostgreSQL |
| Encryption at rest | AES-256 |
| Encryption in transit | TLS 1.3 |
| Physical location | Canadian data centre |

### Static File Hosting

| Attribute | Detail |
|---|---|
| Provider | Netlify |
| Content hosted | HTML, CSS, JavaScript (application code only) |
| Student data stored | None |

All student and teacher data resides exclusively in the Supabase-hosted PostgreSQL database located in Montreal, Canada. The static files served by Netlify contain no personal information.

---

## 6. Access Controls

### Authentication

- Teachers authenticate using email and password.
- Passwords are hashed using bcrypt before storage (handled by Supabase Auth).
- Session tokens are issued upon login and expire automatically.

### Authorization — Row-Level Security (RLS)

Every database table enforces Row-Level Security policies at the database level. This means:

- Each teacher can only read, create, update, or delete their own data.
- There is no way for one teacher to access another teacher's students, courses, or assessment records, even by manipulating API requests.
- RLS is enforced by PostgreSQL itself, not by application code, providing a strong security boundary.

### What Access Does NOT Exist

- There are no student accounts. Students never log in or access the system.
- There are no parent accounts.
- There is no shared admin account that can view all teachers' data.
- The developer does not have routine access to production data. Database access requires explicit authentication to Supabase's management console.

---

## 7. Data Retention

| Data Type | Retention Period |
|---|---|
| Active course data | Retained while the course is active |
| Archived courses | Retained for 5 years after the school year ends, per BC records retention requirements |
| Deleted students | Immediately and permanently removed from the database |
| Deleted courses | Immediately and permanently removed, including all associated student records and assessments |
| Teacher account (upon deletion request) | All data permanently deleted within 30 days |

### Teacher Control Over Their Data

- Teachers can export all of their data as a JSON file at any time.
- Teachers can delete individual students, individual courses, or their entire account.
- Deletion is permanent. There is no "soft delete" or recycle bin.

---

## 8. Data Sharing

**FullVision does not share data with any third party.**

| Sharing Scenario | Status |
|---|---|
| Third-party analytics | Not used |
| Advertising networks | Not used |
| Data brokers | Not used |
| Other school districts | Not shared |
| Ministry of Education | Not shared (teachers manually enter report card data into district systems) |
| Other teachers | Not shared (RLS prevents cross-teacher access) |
| Parents/guardians | Not shared (reports are printed by the teacher and distributed per school policy) |

Reports are generated entirely within the teacher's browser and can be printed or saved as PDF locally. No report data is transmitted to external services.

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Residual Risk |
|---|---|---|---|---|
| Unauthorized access to a teacher's account | Low | Medium | Email/password authentication; session expiry; password hashing (bcrypt) | Low |
| One teacher accessing another's data | Very Low | High | Row-Level Security enforced at database level; no shared admin access | Very Low |
| Data breach at Supabase | Very Low | High | AES-256 encryption at rest; TLS 1.3 in transit; Supabase SOC 2 Type II compliance; automated backups | Low |
| Data loss | Very Low | Medium | Supabase automated daily backups retained for 7 days; teacher data export feature | Low |
| Interception of data in transit | Very Low | High | TLS 1.3 encryption on all connections | Very Low |
| Data stored outside Canada | Very Low | High | Supabase region explicitly set to ca-central-1 (Montreal); no third-party services that transfer data internationally | Very Low |

**Overall residual risk: Low.**

---

## 10. Compliance Statement

### FOIPPA Section 30.1 — Storage in Canada

All personal information is stored and accessed in Canada. The database is hosted in AWS's ca-central-1 region (Montreal, Quebec). No personal information is transferred to, stored in, or accessible from servers outside of Canada. This application is compliant with FOIPPA section 30.1.

### Accessibility

FullVision is designed to meet WCAG 2.1 Level AA accessibility standards, including:

- Keyboard navigation support
- Semantic HTML for screen reader compatibility
- Sufficient colour contrast ratios
- Readable text sizing

### Privacy by Design

The application follows privacy-by-design principles:

- **Data minimization:** Only data necessary for assessment and reporting is collected.
- **Purpose limitation:** Data is used solely for educational assessment.
- **Access limitation:** Row-Level Security ensures strict data isolation between teachers.
- **No tracking:** No analytics, cookies (beyond auth), or advertising.
- **Teacher control:** Teachers can export and delete their own data at any time.

---

**Prepared by:** Colin Brown
**Contact:** brown_colin@surreyschools.ca
**Date:** March 22, 2026
