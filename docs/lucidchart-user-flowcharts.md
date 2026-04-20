# Lucidchart User Flowcharts

These are Mermaid flowcharts prepared for Lucidchart:

- `lucidchart-first-time-report-flow.mmd`
- `lucidchart-teacher-assignment-comment-grade-flow.mmd`

## Flowchart 1

First-time teacher path from login to printed reports.

```mermaid
flowchart TD
    A([Teacher logs in]) --> B[Land on Dashboard]
    B --> C{Is the course and roster ready?}

    C -- No --> D[Create or select the course]
    D --> E[Add students or import roster]
    E --> F[Review class setup on Dashboard]

    C -- Yes --> F

    F --> G[Open Assignments]
    G --> H[Create the first assignment]
    H --> I[Link learning targets / tags]
    I --> J[Choose scoring approach\nProficiency or points]
    J --> K[Enter student scores]
    K --> L[Add comments, notes,\nor observations]
    L --> M{Enough evidence for reporting?}

    M -- No --> N[Repeat assignments,\ngrading, and comments]
    N --> G

    M -- Yes --> O[Open Reports]
    O --> P[Choose report blocks and settings]
    P --> Q[Complete questionnaire / narrative inputs]
    Q --> R[Preview student reports]
    R --> S{Ready to print?}

    S -- No --> T[Return to grades,\ncomments, or report settings]
    T --> K

    S -- Yes --> U([Print or export reports])
```

## Flowchart 2

Recurring teacher workflow for assignments, comments, and grades.

```mermaid
flowchart TD
    A([Teacher opens active course]) --> B[Open Assignments]
    B --> C{New assignment or existing one?}

    C -- New --> D[Create assignment]
    C -- Existing --> E[Open existing assignment]

    D --> F[Set title, date, type,\nand linked tags]
    E --> F

    F --> G[Choose rubric, points,\nor proficiency setup]
    G --> H[Enter grades or proficiency\nfor each student]
    H --> I[Mark exceptions if needed\nMissing, excused, not submitted]
    I --> J[Add comments, feedback,\nor observations]
    J --> K[Review results in Gradebook,\nDashboard, or Student view]
    K --> L{Need revisions?}

    L -- Yes --> M[Adjust assignment setup,\ngrades, or comments]
    M --> F

    L -- No --> N[Save locally and sync\nin the background]
    N --> O([Evidence is ready for\nprogress tracking and reports])
```
