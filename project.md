# PG Clinical Activity Tracking System
### Business Requirements Document (BRD) & Software Requirements Specification (SRS)

---

> **Document Type:** BRD + SRS
> **Stack:** MERN (MongoDB, Express.js, React.js, Node.js)
> **Target Users:** PG Doctors, HODs, Consultants, Admins, MRD Staff

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Purpose of the System](#2-purpose-of-the-system)
3. [Business Requirements (BRD)](#3-business-requirements-brd)
4. [Software Requirements (SRS)](#4-software-requirements-srs)
5. [Master Modules](#5-master-modules)
6. [Patient Management Module](#6-patient-management-module)
7. [PG Activity Tracking Module](#7-pg-activity-tracking-module)
8. [Patient Journey Timeline Module](#8-patient-journey-timeline-module)
9. [Procedure Tracking Module](#9-procedure-tracking-module)
10. [Progress Note Module](#10-progress-note-module)
11. [Discharge Summary Module](#11-discharge-summary-module)
12. [Dashboard Module](#12-dashboard-module)
13. [Analytics Module](#13-analytics-module)
14. [Reports Module](#14-reports-module)
15. [Audit Log Module](#15-audit-log-module)
16. [Security Requirements](#16-security-requirements)
17. [Non-Functional Requirements](#17-non-functional-requirements)
18. [Database Design](#18-database-design)
19. [API Reference](#19-api-reference)
20. [UI Screen List](#20-ui-screen-list)
21. [Implementation Phases](#21-implementation-phases)
22. [Future Enhancements](#22-future-enhancements)
23. [Conclusion](#23-conclusion)

---

## 1. Project Overview

**Project Name:** PG Clinical Activity Tracking System

A centralized digital platform to monitor, record, and analyze the complete clinical activities of Postgraduate (PG) doctors — covering the full patient journey from admission to discharge.

---

## 2. Purpose of the System

The system will help the hospital:

- Track PG clinical activities in real time
- Monitor patient-wise PG involvement
- Compare PG workloads across departments
- Identify inactive or overloaded PGs
- Monitor clinical exposure for academic purposes
- Improve accountability and documentation
- Support academic evaluations
- Fulfill NABH audit requirements

---

## 3. Business Requirements (BRD)

### 3.1 Business Objective

The hospital requires a centralized platform to:

- Monitor PG doctor activities
- Track patient assignments
- Measure clinical exposure
- Compare PG performance
- Generate department-level analytics
- Ensure fair patient distribution
- Improve documentation traceability

---

### 3.2 Existing Problems

| # | Problem | Description |
|---|---------|-------------|
| 1 | No PG Tracking | No centralized system to track PG activities |
| 2 | Unequal Distribution | Some PGs handle disproportionately more patients |
| 3 | No Visibility | HODs cannot see actual PG involvement |
| 4 | No Activity History | No patient-wise PG activity timeline exists |
| 5 | Manual Monitoring | Difficult to compare PG performance objectively |
| 6 | Audit Difficulties | Lack of documentation traceability for NABH |

---

### 3.3 Proposed Solution

Develop a **web-based PG Tracking System** using the **MERN Stack** that will:

- Assign patients to PG doctors
- Log every PG clinical activity
- Maintain a complete patient clinical timeline
- Generate dashboards and analytics
- Compare PG workloads fairly
- Produce HOD and management reports
- Maintain comprehensive audit logs

---

### 3.4 Stakeholders

| Stakeholder | Role |
|-------------|------|
| Hospital Management | Monitoring & analytics oversight |
| HOD | PG evaluation and performance review |
| Consultants | Patient supervision and round management |
| PG Doctors | Clinical activity logging and tracking |
| MRD Department | Report generation and records management |
| IT Department | System maintenance and support |
| NABH Auditors | Audit trail verification |

---

### 3.5 Business Benefits

| Benefit |
|---------|
| Better PG monitoring and accountability |
| Fair and transparent workload distribution |
| Improved academic tracking and evaluation |
| Structured documentation and compliance |
| Real-time dashboards for decision-making |
| Better NABH audit support |
| Complete patient journey visibility |

---

### 3.6 Scope

#### In Scope

- PG master management
- Department and unit management
- Patient admission and assignment
- Clinical activity logging
- Progress note tracking
- Procedure tracking
- Discharge summary tracking
- Dashboard analytics
- Report generation
- Audit logs

#### Out of Scope

- Billing module
- Pharmacy module
- Laboratory module
- PACS integration
- Full EMR replacement

---

## 4. Software Requirements (SRS)

### 4.1 System Architecture

#### Technology Stack — MERN

| Layer | Technology |
|-------|------------|
| **Frontend** | React.js, Vite, Tailwind CSS, Redux Toolkit, Axios, Recharts |
| **Backend** | Node.js, Express.js, JWT Authentication, REST APIs |
| **Database** | MongoDB, Mongoose ODM |
| **Deployment** | Nginx, PM2, Ubuntu Server, Docker *(optional)* |

---

### 4.2 User Roles & Access

| Role | Access Level |
|------|-------------|
| Admin | Full system access — all modules and departments |
| HOD | Department-level analytics and PG evaluation |
| Consultant | Unit-level patient monitoring and supervision |
| PG Doctor | Own patient activities and assigned cases |
| MRD User | Reports generation and audit access |

---

## 5. Master Modules

### 5.1 PG Masters

**Purpose:** Maintain complete PG doctor profiles and credentials.

| Field | Type |
|-------|------|
| PG ID | Auto-generated |
| PG Name | Text |
| Department | Dropdown |
| Unit | Dropdown |
| Year of Residency | Dropdown |
| Mobile Number | Text |
| Email | Text |
| Joining Date | Date |
| Status | Active / Inactive |
| Username | Text |
| Password | Encrypted (bcrypt) |

**Functions:** Add PG · Edit PG · Deactivate PG · Assign Unit · Reset Password

---

### 5.2 Department Masters

**Purpose:** Manage all hospital departments and their metadata.

| Field | Type |
|-------|------|
| Department ID | Auto-generated |
| Department Name | Text |
| Department Code | Text |
| HOD Name | Text |
| Status | Active / Inactive |

---

### 5.3 Unit Masters

| Field | Type |
|-------|------|
| Unit ID | Auto-generated |
| Unit Name | Text |
| Consultant | Dropdown |
| Department | Dropdown |

---

### 5.4 Activity Masters

**Purpose:** Define all clinical activity types available for logging.

| Activity Type |
|---------------|
| Admission Assessment |
| Progress Note |
| Consultant Round |
| Procedure Assist |
| ICU Review |
| Referral |
| Discharge Summary |
| Emergency Review |

---

## 6. Patient Management Module

### 6.1 Patient Admission

**Purpose:** Register patient admission and initiate PG assignment.

**Functions:** Capture admission details · Assign PG doctor · Assign consultant · Create patient timeline

| Field |
|-------|
| IP Number |
| Patient Name |
| Age / Gender |
| Department |
| Unit |
| Consultant |
| Assigned PG |
| Admission Date |
| Ward / Bed Number |

---

### 6.2 Patient Assignment

**Functions:** Assign patient to PG · Reassign patient · Map multiple PGs · Shift-based assignment

---

## 7. PG Activity Tracking Module

**Purpose:** Track every clinical activity performed by a PG doctor during a patient's stay, maintaining a complete time-stamped log.

### Activity Log Fields

| Field | Description |
|-------|-------------|
| Activity ID | Auto-generated unique ID |
| Patient ID | Linked patient record |
| PG ID | Linked PG doctor record |
| Activity Type | From Activity Masters |
| Activity Date | Date of activity |
| Activity Time | Time of activity |
| Remarks | Optional clinical notes |
| Created By | User who logged the entry |

### Activity Flow

```
Patient Assigned
       ↓
PG Performs Clinical Activity
       ↓
Activity Logged in System
       ↓
Patient Timeline Updated
       ↓
Dashboard & Analytics Updated
```

---

## 8. Patient Journey Timeline Module

**Purpose:** Maintain a complete, chronological clinical timeline per patient from admission to discharge.

| Timeline Activity |
|-------------------|
| Admission |
| Initial Assessment |
| Daily Rounds |
| Procedures |
| ICU Reviews |
| Progress Notes |
| Referrals |
| Discharge Summary |

### Example Timeline

| Time | Activity |
|------|----------|
| 10:20 AM | Patient Admitted |
| 10:40 AM | Initial Assessment by PG |
| 11:00 AM | Consultant Round |
| 2:00 PM | Procedure Assist |
| Day 5 | Discharge Summary Prepared |

---

## 9. Procedure Tracking Module

**Purpose:** Track all procedures performed or assisted by PG doctors for academic exposure monitoring.

| Field | Description |
|-------|-------------|
| Procedure Name | Name of clinical procedure |
| Patient | Linked patient record |
| PG | Performing / assisting PG |
| Role | Performed / Assisted / Observed |
| Date | Date of procedure |
| Consultant | Supervising consultant |

| Role | Description |
|------|-------------|
| Performed | PG independently performed the procedure |
| Assisted | PG assisted the consultant |
| Observed | PG observed only |

---

## 10. Progress Note Module

**Features:** Add notes · Edit notes · View note history · Track delayed entries

| Field | Type |
|-------|------|
| Note ID | Auto-generated |
| Patient | Linked patient |
| PG | Linked PG doctor |
| Note Content | Text |
| Date | Date |
| Time | Time |

---

## 11. Discharge Summary Module

**Features:** Create discharge summary · Track preparation status · Track consultant approval

| Field | Type |
|-------|------|
| Summary ID | Auto-generated |
| Patient | Linked patient |
| Prepared By | PG doctor |
| Diagnosis | Text |
| Medications | Text / Structured |
| Follow-up Instructions | Text |
| Approved By | Consultant |

---

## 12. Dashboard Module

### 12.1 PG Dashboard

| Feature | Description |
|---------|-------------|
| My Patients | Currently assigned patients |
| My Activities | Recent activity log |
| Daily Case Count | Patients handled today |
| Pending Tasks | Overdue notes and summaries |
| Procedure Count | Total procedures this month |

### 12.2 HOD Dashboard

| Feature | Description |
|---------|-------------|
| PG Comparison | Side-by-side PG performance view |
| Department Workload | Total activity across department |
| ICU Exposure | ICU case count per PG |
| Procedure Exposure | Procedure statistics per PG |
| Daily Analytics | Day-wise trends and charts |

### 12.3 Admin Dashboard

| Feature | Description |
|---------|-------------|
| Hospital Analytics | Overall patient and activity overview |
| User Management | Manage all system users |
| Department Reports | Department-level summaries |
| Audit Reports | Full audit trail viewer |

---

## 13. Analytics Module

### 13.1 Key Metrics

| Metric |
|--------|
| Cases Per Day / Week / Month |
| Activity Count Per PG |
| ICU Posting Cases |
| Procedures Performed vs Assisted |
| Documentation Delay Rate |
| Discharge Preparation Delays |

### 13.2 PG Comparison View

| PG | Cases | Activities | Procedures | ICU Cases |
|----|-------|------------|------------|-----------|
| Dr. X | 6 | 45 | 8 | 3 |
| Dr. Y | 2 | 39 | 4 | 1 |

### 13.3 Reason Analysis

The system identifies and flags:

- ICU posting periods
- Leave and off-duty status
- Night duty assignments
- Higher complexity case loads
- Documentation delays and gaps

---

## 14. Reports Module

| Report Name |
|-------------|
| PG-wise Activity Report |
| Department Workload Report |
| Patient Journey Report |
| Procedure Exposure Report |
| ICU Exposure Report |
| Daily Census Report |
| Audit Trail Report |

> All reports support **PDF** and **Excel** export formats.

---

## 15. Audit Log Module

**Purpose:** Track all user actions for compliance and NABH audit requirements.

| Field | Description |
|-------|-------------|
| User | Who performed the action |
| Action | What action was taken |
| Module | Which module was accessed |
| Date & Time | Timestamp of action |
| IP Address | Source IP of request |

---

## 16. Security Requirements

| Feature | Implementation |
|---------|----------------|
| Authentication | JWT (JSON Web Tokens) |
| Password Security | bcrypt encryption |
| Access Control | Role-Based Access Control (RBAC) |
| Session Management | Token expiry and refresh |
| Audit Logging | All actions tracked with timestamps |
| API Security | Protected routes and input validation |

---

## 17. Non-Functional Requirements

| Requirement | Specification |
|-------------|---------------|
| Performance | Response time < 2 seconds |
| Availability | 99% uptime SLA |
| Scalability | Multi-department, multi-unit support |
| Security | Encrypted authentication and HTTPS |
| Backup | Daily automated database backup |

---

## 18. Database Design

### MongoDB Collections

```
users
pgmasters
departments
units
patients
admissions
patient_assignments
pg_activity_logs
progress_notes
procedures
discharge_summaries
notifications
audit_logs
```

---

## 19. API Reference

### Authentication APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/logout` | User logout |
| GET | `/api/auth/profile` | Get current user profile |

### PG Management APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pg` | List all PG doctors |
| POST | `/api/pg` | Create new PG |
| PUT | `/api/pg/:id` | Update PG details |
| DELETE | `/api/pg/:id` | Deactivate PG |

### Patient APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admission` | Register new admission |
| GET | `/api/patients` | List all patients |
| POST | `/api/assign-pg` | Assign PG to patient |

### Activity APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/activity` | Log new PG activity |
| GET | `/api/patient-timeline/:id` | Get patient journey timeline |
| GET | `/api/pg-activities/:pgId` | Get PG activity history |

---

## 20. UI Screen List

### Master Screens
- PG Master (List, Add, Edit)
- Department Master
- Unit Master
- Activity Type Master

### Transaction Screens
- Patient Admission
- Patient Assignment
- Activity Entry
- Procedure Entry
- Progress Notes
- Discharge Summary

### Dashboard Screens
- PG Dashboard
- HOD Dashboard
- Admin Dashboard

### Report Screens
- PG Activity Reports
- Patient Journey Reports
- PG Comparison Reports
- Audit Trail Viewer

---

## 21. Implementation Phases

### Phase 1 — Core Modules *(4 Weeks)*

- [ ] Authentication and role-based access
- [ ] Master module setup (PG, Department, Unit, Activity)
- [ ] Patient admission and assignment
- [ ] Clinical activity logging

### Phase 2 — Analytics & Reporting *(3 Weeks)*

- [ ] PG and HOD dashboards
- [ ] Analytics and comparison views
- [ ] Report generation (PDF + Excel)

### Phase 3 — Mobile Support *(4 Weeks)*

- [ ] Mobile-responsive interface
- [ ] Push notification system
- [ ] QR code patient scan support
- [ ] Voice note entry for activity logging

---

## 22. Future Enhancements

### AI-Powered Features

| Feature | Description |
|---------|-------------|
| Workload Prediction | Forecast PG load based on historical patterns |
| Smart Patient Allocation | AI-based fair patient distribution |
| Burnout Detection | Identify overloaded or at-risk PGs |
| Documentation Assistant | AI-assisted progress note generation |
| Anomaly Detection | Flag unusual or missed activity patterns |

### Mobile App Features

- Voice note entry for activity logging
- Push notifications for alerts and reminders
- QR code scanning for quick patient access
- Offline-capable mobile activity updates

---

## 23. Conclusion

The **PG Clinical Activity Tracking System** transforms fragmented, manual monitoring into a structured, data-driven platform for hospital PG management.

### Final System Outcomes

| Outcome |
|---------|
| Complete PG activity tracking |
| Patient-centric clinical timeline |
| Fair and transparent PG performance comparison |
| Workload imbalance identification |
| Improved accountability and documentation |
| NABH audit readiness |
| Real-time analytics for decision-makers |

> This system is designed to evolve into a **complete Resident Management Platform**, with future integration into HIS/EMR systems — serving as a long-term asset for hospital administration, clinical governance, and academic excellence.

---
