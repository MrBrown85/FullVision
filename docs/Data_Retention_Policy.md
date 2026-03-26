# Data Retention Policy

**Application:** FullVision — Learning Profile Builder and Communicator
**Developer:** Colin Brown (brown_colin@surreyschools.ca)
**District:** Surrey School District
**Date:** March 22, 2026
**Version:** 1.0

---

## 1. Purpose

This policy defines how long student and teacher data is retained within FullVision, when data is deleted, and how teachers can manage their own data. It is designed to meet BC records retention requirements while respecting the privacy rights of students and teachers under FOIPPA.

---

## 2. Retention Schedule

### Active Course Data

| Item | Retention Rule |
|---|---|
| Student records | Retained for the duration of the active course |
| Assessment scores | Retained for the duration of the active course |
| Teacher observations and comments | Retained for the duration of the active course |
| Learner disposition ratings | Retained for the duration of the active course |

Active data remains accessible to the teacher through the application for day-to-day use.

### Archived Courses

| Item | Retention Rule |
|---|---|
| Completed or archived courses and all associated data | Retained for a minimum of **5 years** after the end of the school year in which the course was active |

This retention period aligns with BC records retention schedules for student assessment records. After 5 years, teachers may delete archived courses at their discretion.

### Deleted Students

| Item | Retention Rule |
|---|---|
| Individual student records deleted by a teacher | **Immediately and permanently removed** from the database |

When a teacher deletes a student, all associated data (assessment scores, observations, disposition ratings) is permanently deleted. There is no soft delete, recycle bin, or recovery period.

### Deleted Courses

| Item | Retention Rule |
|---|---|
| Courses deleted by a teacher | **Immediately and permanently removed** from the database |

Deleting a course triggers a cascade deletion of all associated data, including all enrolled students, assessment records, observations, and disposition ratings within that course.

### Teacher Account Deletion

| Item | Retention Rule |
|---|---|
| All data associated with a deleted teacher account | **Permanently deleted within 30 days** of the deletion request |

When a teacher requests account deletion, all of their data is permanently removed from the database, including all courses, students, assessments, observations, and authentication credentials. No data is retained after the 30-day processing window.

---

## 3. Export Before Deletion

Teachers are encouraged to export their data before performing any deletion. The application provides a data export feature that produces a complete JSON file containing all of the teacher's data, including:

- All courses
- All students and their enrollment records
- All assessment scores
- All observations and comments
- All learner disposition ratings

This export can be saved locally by the teacher for their own records. The export is performed entirely within the browser and the data is not sent to any third party.

**It is the teacher's responsibility to export data before deletion.** Deleted data cannot be recovered.

---

## 4. Backups

### Automated Backups

| Attribute | Detail |
|---|---|
| Frequency | Daily |
| Provider | Supabase (automated) |
| Retention period | **7 days** |
| Storage location | AWS ca-central-1 (Montreal, Canada) |
| Encryption | AES-256 at rest |

After 7 days, backup data is automatically and permanently deleted by Supabase. Backups exist solely for disaster recovery (such as database corruption or infrastructure failure) and are not used for data restoration requests from individual users.

### Backup Access

Backups are managed by Supabase infrastructure. The application developer does not maintain separate backups of production data.

---

## 5. Policy Review

This policy is reviewed annually to ensure it remains aligned with:

- BC FOIPPA requirements
- BC records retention schedules
- Surrey School District policies
- Changes to the application's data model or hosting infrastructure

| Review Item | Frequency |
|---|---|
| Full policy review | Annually |
| Retention schedule verification | Annually |
| Backup configuration verification | Annually |
| Next scheduled review | March 2027 |

---

## 6. Summary Table

| Data Type | Retention Period | Deletion Method |
|---|---|---|
| Active course data | While course is active | Teacher-initiated |
| Archived courses | Minimum 5 years after school year ends | Teacher-initiated after retention period |
| Deleted student | Immediate permanent deletion | Cascade (all associated data removed) |
| Deleted course | Immediate permanent deletion | Cascade (all associated data removed) |
| Teacher account deletion | Within 30 days | All data permanently removed |
| Database backups | 7 days (rolling) | Automatic (Supabase managed) |

---

**Prepared by:** Colin Brown
**Contact:** brown_colin@surreyschools.ca
**Date:** March 22, 2026
