---
title: Where Your Data Lives
section: Privacy and Your Data
order: 1
summary: FullVision stores teacher and student information in a database in Canada. Each device keeps a working copy of the teacher's classes in the browser until sign-out.
checked: 2026-11-05
pages:
  - /dashboard
demo: /dashboard
labels:
  - Sign Out
  - Class Management
  - Class Actions
  - Download Class Backup
  - Restore from Backup
  - Backup File
  - Class Name
  - Restore
next:
  - create-a-class
  - glossary
shots:
  - file: where-your-data-lives.jpg
    route: /dashboard
    steps:
      - click role=button[name="Class Management"]
      - click role=button[name=/Class Actions/]
    clip: 252,104,1176,300
---

## The Database

All teacher and student information is stored by Supabase in its Montreal data centre (AWS ca-central-1). Each teacher sees only their own classes and students; the database enforces this on every request. Web pages are delivered by Netlify, which does not receive the information in the gradebook.

## This Device

FullVision keeps a copy of the teacher's classes in the browser so it works offline, along with changes waiting to be saved. Choosing **Sign Out** removes this copy, saved printed report copies and the sign-in from this device. If some changes have not reached the server yet, FullVision asks before signing out. Signing out of one device leaves other devices signed in.

Demo Mode keeps everything on the device it runs on. Nothing in Demo Mode is sent to an account.

## Error Reports

When an error occurs, it sends a report to Sentry, which stores reports in Germany. A report holds the error message, where in the code it happened, the page and the browser type. Before it is sent, FullVision removes log messages, form contents and the part of the page address that identifies a student, and masks email addresses, ids, dates and student numbers. No IP address is sent.

## Download a Class Backup

A class backup is a file that holds one class's students, competencies, assessments, scores, comments and observations. Questionnaires are not included. It is saved on the computer, not in FullVision.

1. Open **Class Management** from the Dashboard and select the class.
2. Choose **Class Actions**, then **Download Class Backup**. The browser saves the class as a .json file.

![The Class Actions menu in Class Management with Download Class Backup](img/where-your-data-lives.jpg 'Class Actions in Class Management. Download Class Backup saves the class as a file.')

## Restore a Class From a Backup

1. In **Class Management**, choose **Restore from Backup** at the foot of the class list.
2. Under **Backup File**, choose the saved file. The window shows how many students and assessments it holds and when it was saved.
3. Check the **Class Name**, then choose **Restore**. The backup becomes a new class. Other classes do not change.

The full [Privacy Policy](/privacy.html) covers what FullVision stores, who can see it and how long it is kept.
