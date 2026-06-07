# Phase 14 — Advanced PDF Export Planning Document

> **Status:** Planning Only — APPROVAL REQUIRED before implementation.  
> **Tag awaiting:** `phase-14-plan-approved`  
> **Last Updated:** 2026-06-07  
> **Dependencies:** Phase 11 (Settings), Phase 7 (Fees/Receipts), Phase 12 (Result Cards), Phase 13B (Excel Import/Export)

---

## 1. Existing Print / PDF Findings

### 1.1 Result Cards (`src/modules/resultCards/ResultCardsPage.tsx`)
- **Print method:** `window.open('', '_blank')` + `document.write()` with full inline HTML/CSS.
- **Font:** Google Fonts `@import` for Cairo (weight 400/600/700).
- **RTL:** Hardcoded `<html dir="rtl" lang="ar">`.
- **Paper size:** A4 hardcoded (`width: 210mm; min-height: 297mm`).
- **CSS approach:** Inline `<style>` block inside the injected HTML string.
- **QR:** Rendered via `qrcode.react` (`QRCodeSVG`) inside `printRef` div, then captured as `innerHTML`.
- **Print record API:** `markResultCardPrinted()` exists but is **not** called during the print flow in the current code (only `generateStudentResultCard` + `getResultCard` are used). The `printRef` approach does **not** record a print log automatically.
- **Snapshot usage:** Uses `cardDetails` object (returned from `getResultCard` API) which includes snapshot data stored at generation time.

### 1.2 Official Books (`src/modules/officialBooks/OfficialBooksPage.tsx`)
- **Print method:** Two-step flow: (1) call `printOfficialBook(book.id)` API to record the print, (2) call `window.print()` on the **current page** (not a popup).
- **Print record:** ✅ Automatically created via API before printing.
- **Preview:** Modal with `printRef` and `print:p-0` Tailwind class; `PrintPreview` component renders using `settings_snapshot_json` parsed from the book record.
- **Snapshot fields stored in DB:** `school_name_snapshot`, `principal_name_snapshot`, `logo_url_snapshot`, `stamp_url_snapshot`, `use_logo_snapshot`, `use_stamp_snapshot`, `header_text_snapshot`, `footer_text_snapshot`, `verification_note_snapshot`, `date_format_snapshot`, `use_arabic_indic_digits_snapshot`, `settings_snapshot_json`.
- **Logo/Stamp:** Conditionally rendered from parsed snapshot JSON.

### 1.3 Fee Receipts (`src/modules/fees/FeesPage.tsx`)
- **Print method:** Not yet implemented in the read section. The page imports `Printer` icon but no dedicated print handler was found in the first 100 lines. Receipts are generated via `generateFeeReceipt` API.
- **Receipt data:** `receipt_number`, `student_name_snapshot`, `total_amount`, `status`, `verification_token`, `created_at`.
- **Print record:** Receipts are expected to have a `print_type = 'receipt'` in `print_records` (the table already supports it).

### 1.4 Print Records Module (`src/modules/printRecords/PrintRecordsPage.tsx`)
- **Table:** `print_records` with columns: `id`, `school_id`, `document_id`, `print_type`, `printed_at`, `printed_by_user_id`, `printer_info_json`, `created_at`.
- **Supported types:** `official_book`, `result_card`, `receipt` (UI badge labels exist for all three).
- **Filters:** By type, date range, user ID.
- **RBAC:** No role-based filtering on the page itself; all authenticated users can view records.

### 1.5 Settings / Document Tab (`src/modules/settings/DocumentTab.tsx`)
- **Available fields:** `result_card_header_text`, `result_card_footer_text`, `receipt_footer_text`, `verification_note_text`, `use_school_logo_on_docs`, `use_school_stamp_on_docs`, `default_print_size` (A4/A5/Letter), `default_receipt_size` (A5/A4).
- **Additional fields in DB/worker:** `logo_url`, `official_stamp_url`, `official_book_header_text`, `official_book_footer_text`, `use_arabic_indic_digits`, `date_format`, `currency_label`.

### 1.6 Worker APIs (`src/worker.ts`)
- **Print records INSERT (line ~6008):**
  ```sql
  INSERT INTO print_records (school_id, document_id, print_type, printed_at, printed_by_user_id, printer_info_json)
  VALUES (?, ?, 'official_book', unixepoch(), ?, ?)
  ```
- **Print records SELECT (line ~6035):** Joins with `users` to get `printed_by_name`.
- **Settings fields (lines ~5436, 5450, 5522, 5533, 5579):** Full list of document settings available.
- **Import/Export (lines 6319–7180):** `PHASE13A_TYPES = ['students', 'classes-sections', 'subjects', 'employees', 'grades', 'student-subjects']`.

### 1.7 Dependencies
- **Current:** `qrcode.react` (already used), `xlsx` (Phase 13B chunk).
- **No PDF library** is currently installed.
- **Build outputs:** Frontend ~687 kB, Worker ~241 kB, xlsx chunk ~430 kB.

---

## 2. Recommended PDF Technical Approach

### 2.1 Option Analysis

| Option | Approach | Arabic RTL | Bundle Size | Cloudflare Worker | Verdict |
|--------|----------|------------|-------------|-------------------|---------|
| **Option 1** | Browser print (`window.print()` + print CSS) | ✅ Excellent (browser native) | ✅ No added deps | ✅ Not needed | **RECOMMENDED** |
| **Option 2** | Client-side jsPDF / html2canvas / html2pdf | ⚠️ Risky (RTL/bidi issues) | ❌ +150–400 kB | ✅ Not needed | Reject for MVP |
| **Option 3** | Server-side Puppeteer/Playwright in Worker | ❌ Not available in Workers | ❌ Heavy | ❌ Exceeds limits | Reject |

### 2.2 Selected Approach: Enhanced Browser Print Architecture
**For Phase 14 MVP, we do NOT add a PDF library.** We standardize and enhance the existing browser print-to-PDF approach:

1. **Unified `PrintLayout` component** with print-only CSS (`@media print`) and a hidden `printRef` container.
2. **Popup window injection** (like Result Cards) for documents that need a clean, isolated print canvas.
3. **Direct `window.print()`** (like Official Books) for modal previews where the parent page chrome is already hidden.
4. **Print-trigger helper** that optionally calls an API to record the print before opening the print dialog.
5. **All styles are inline** (no external CSS files needed for the print window) to avoid Cloudflare static asset issues.
6. **User instruction:** The browser print dialog will offer "Save as PDF" natively. No additional download flow needed.

### 2.3 Justification
- Arabic text + RTL + Indic digits work perfectly in all modern browsers.
- Cairo font renders correctly via Google Fonts `@import`.
- No bundle size increase.
- No runtime dependency risk.
- Works offline after page load.
- QR codes remain vector-sharp (SVG-based).
- If a future phase demands **server-side PDF** (e.g., batch email attachments), we can revisit `jsPDF` or a micro-service. For now, browser print is the correct choice.

---

## 3. Reusable Print Architecture

### 3.1 Proposed Shared Components (all in `src/components/print/`)

```
src/components/print/
├── PrintLayout.tsx          # Outer wrapper: A4/A5/Letter sizing, RTL, Cairo font
├── DocumentHeader.tsx         # Logo + school name + principal + header text
├── DocumentFooter.tsx         # Footer text + stamp + verification note + date
├── QRBlock.tsx                # QR code + URL text + verification note
├── PrintableTable.tsx         # RTL table with Arabic headers, striped rows
├── PrintButton.tsx            # Button with icon + optional print-record API call
├── usePrintExport.ts          # Hook: open popup, write HTML, trigger print, record log
└── printStyles.ts             # Shared inline CSS strings (constants)
```

### 3.2 `PrintLayout` Props
```typescript
interface PrintLayoutProps {
  paperSize: 'A4' | 'A5' | 'Letter';
  direction: 'rtl' | 'ltr';              // always 'rtl' for this system
  children: React.ReactNode;
  settings: DocumentSettingsSnapshot;   // logo, stamp, header, footer
  showLogo: boolean;
  showStamp: boolean;
}
```

### 3.3 `usePrintExport` Hook API
```typescript
function usePrintExport(options: {
  printType: 'result_card' | 'receipt' | 'official_book' | 'student_list' | 'grade_sheet' | 'finance_report' | 'salary_report';
  documentId: number;
  onBeforePrint?: () => Promise<void>;  // e.g., call API to mark printed
  copiesCount?: number;
  notes?: string;
}): {
  printRef: React.RefObject<HTMLDivElement>;
  handlePrint: () => void;              // popup + print
  handlePrintInline: () => void;       // window.print() directly
  isPrinting: boolean;
}
```

### 3.4 Print Style Constants (`printStyles.ts`)
- A4: `210mm × 297mm`
- A5: `148mm × 210mm`
- Letter: `216mm × 279mm`
- Cairo font import string.
- `@media print` overrides: remove borders, backgrounds, ensure `body { background: #fff }`.
- Arabic-Indic digit helper integrated.

---

## 4. Document Types Supported in Phase 14A

Phase 14A will focus on **core academic documents** that already have data snapshots and existing verification flows.

### 4.1 Phase 14A (Core Documents — Highest Priority)
| # | Document Type | Existing Data | Existing Print | QR Verification | Snapshot |
|---|---------------|-------------|----------------|-----------------|----------|
| 1 | **Individual Result Card PDF** | ✅ | ✅ (basic) | ✅ | ✅ |
| 2 | **Section Result Cards PDF** | ✅ | ❌ (batch) | ✅ | ✅ |
| 3 | **Individual Fee Receipt PDF** | ✅ | ⚠️ (no handler) | ✅ | ✅ |
| 4 | **Official Book PDF** | ✅ | ✅ | ✅ | ✅ |

### 4.2 Phase 14B (Lists & Sheets)
| # | Document Type | Source Data | New Query Needed | RBAC Impact |
|---|---------------|-------------|------------------|-------------|
| 5 | **Students by Class/Section List PDF** | `students` table | No | Registrar+ |
| 6 | **Student Contact List PDF** | `students` table | No | Registrar+ |
| 7 | **Student Subjects List PDF** | `student_subjects` join | No | Registrar+ |
| 8 | **Grade Sheet by Class/Section/Subject PDF** | `grades` + `students` | No | Teacher+ (restricted) |
| 9 | **Student Annual Grade Summary PDF** | `grades` aggregate | Yes (new endpoint) | Teacher+ |
| 10 | **Failed/Completion Students PDF** | `grades` + `result_cards` | Yes (new endpoint) | Teacher+ |
| 11 | **Exempt Students PDF** | `grades` (`general_exemption_status`) | Yes | Teacher+ |

### 4.3 Phase 14C (Finance & HR Reports)
| # | Document Type | Source Data | RBAC Restriction |
|---|---------------|-------------|------------------|
| 12 | **Fees Summary PDF** | `student_fees` + `fee_payments` | Accountant only |
| 13 | **Unpaid Students PDF** | `student_fees` | Accountant only |
| 14 | **Paid Receipts List PDF** | `fee_receipts` | Accountant only |
| 15 | **Treasury Daily Report PDF** | `treasury` | Accountant only |
| 16 | **Treasury Monthly Report PDF** | `treasury` | Accountant only |
| 17 | **Employees List PDF** | `employees` | Accountant/Owner |
| 18 | **Salaries by Month PDF** | `salaries` | Accountant/Owner |
| 19 | **Paid/Unpaid Salary Report PDF** | `salaries` | Accountant/Owner |

---

## 5. Route / Page Plan

### 5.1 Option A: Dedicated Print Routes (Recommended for Phase 14A)
Create standalone print-view pages that can be opened in a popup or new tab. These are **minimal chrome** pages (no Layout sidebar, no nav) with a single print button.

| Route | Component | Purpose | Auth |
|-------|-----------|---------|------|
| `/print/result-card/:id` | `PrintResultCardPage.tsx` | Individual result card print view | ✅ JWT |
| `/print/result-cards/section/:sectionId` | `PrintSectionResultCardsPage.tsx` | Batch section cards | ✅ JWT |
| `/print/receipt/:id` | `PrintReceiptPage.tsx` | Individual receipt | ✅ JWT |
| `/print/official-book/:id` | `PrintOfficialBookPage.tsx` | Single official book | ✅ JWT |
| `/print/students` | `PrintStudentListPage.tsx` | Filtered student list | ✅ JWT |
| `/print/grades` | `PrintGradeSheetPage.tsx` | Grade sheet by filters | ✅ JWT |
| `/print/fees` | `PrintFeesReportPage.tsx` | Fee summary report | ✅ JWT |
| `/print/treasury` | `PrintTreasuryReportPage.tsx` | Treasury report | ✅ JWT |
| `/print/salaries` | `PrintSalariesReportPage.tsx` | Salary report | ✅ JWT |

**Alternative (simpler for Phase 14A):** Keep print views as **modal components** inside existing pages (like Official Books) rather than separate routes. This avoids routing changes and keeps the user in context. Phase 14B can introduce dedicated routes if needed for batch reports.

**Recommended Phase 14A approach:**
- Use **modal/inline print preview** for individual documents (Result Card, Receipt, Official Book) to minimize changes.
- Use **dedicated route pages** for batch/list exports (Section Result Cards, Student Lists, Grade Sheets) because they need a full-page canvas and clean print experience.

### 5.2 Route Registration (`App.tsx`)
Phase 14A adds only 2–3 new routes:
```typescript
<Route path="/print/result-cards/section/:sectionId" element={<PrintSectionResultCardsPage />} />
<Route path="/print/students" element={<PrintStudentListPage />} />
<Route path="/print/grades" element={<PrintGradeSheetPage />} />
```
Individual document prints (Result Card, Receipt, Official Book) remain inline/modal inside their parent pages.

---

## 6. API / Data Requirements

### 6.1 Existing APIs (No Changes Needed)
| Endpoint | Data Provided | Used By |
|----------|---------------|---------|
| `GET /api/result-cards/:id` | Full card details + snapshot | Individual result card print |
| `GET /api/result-cards?student_id=&section_id=` | List of cards | Section/class batch export |
| `GET /api/fee-receipts/:id` | Receipt details + snapshot | Receipt print |
| `GET /api/official-books/:id` | Book + snapshot JSON | Official book print |
| `GET /api/print-records` | Print history | Print records page |
| `GET /api/settings` | Document settings | All print layouts |
| `GET /api/students` | Student list | Student list PDF |
| `GET /api/grades` | Grades data | Grade sheets |

### 6.2 New APIs Needed (Phase 14A)
| Endpoint | Purpose | RBAC |
|----------|---------|------|
| `POST /api/print-records` | Generic print record insertion (not just official books) | Any authenticated user |
| `GET /api/result-cards/section/:sectionId` | Batch cards for a section with details | Academic roles |
| `GET /api/grades/sheet?class_id=&section_id=&subject_id=` | Grade sheet aggregation | Teacher+ (own scope) |

### 6.3 New APIs Needed (Phase 14B)
| Endpoint | Purpose |
|----------|---------|
| `GET /api/students/export-list?class_id=&section_id=` | Filtered student list with contacts |
| `GET /api/students/subjects-list?class_id=` | Student-subject mapping |
| `GET /api/grades/summary?student_id=` | Annual grade summary per student |
| `GET /api/grades/failed-students?year=` | Failed/completion list |
| `GET /api/grades/exempt-students?year=` | Exempt students list |

### 6.4 New APIs Needed (Phase 14C)
| Endpoint | Purpose | RBAC |
|----------|---------|------|
| `GET /api/fees/summary-report` | Fees summary | Accountant |
| `GET /api/fees/unpaid-report` | Unpaid students | Accountant |
| `GET /api/treasury/daily-report?date=` | Daily treasury | Accountant |
| `GET /api/treasury/monthly-report?month=` | Monthly treasury | Accountant |
| `GET /api/employees/export-list` | Employee list | Accountant/Owner |
| `GET /api/salaries/monthly-report?month=` | Salary report | Accountant/Owner |

### 6.5 Data Safety Rules
- **All APIs must include `school_id = ?` filter.**
- **Cross-school data must never be returned.**
- **Public verification APIs (`/verify/...`) must NOT be used for admin PDF data.** They are only for external QR scanning.
- **Authenticated APIs must be used for all private PDF content.**
- **PDF exports must not mutate records** except the optional `print_records` insert.

---

## 7. RBAC Rules

### 7.1 Role Permissions for PDF Export

| Role | Result Cards | Receipts | Official Books | Student Lists | Grade Sheets | Finance Reports | Salary Reports |
|------|------------|----------|----------------|---------------|--------------|-----------------|----------------|
| `system_admin` | ✅ All | ✅ All | ✅ All | ✅ All | ✅ All | ✅ All | ✅ All |
| `school_owner` | ✅ Own school | ✅ Own school | ✅ Own school | ✅ Own school | ✅ Own school | ✅ Own school | ✅ Own school |
| `principal` | ✅ Own school | ✅ Own school | ✅ Own school | ✅ Own school | ✅ Own school | ❌ | ❌ |
| `vice_principal` | ✅ Academic | ✅ Academic | ✅ Academic | ✅ Academic | ✅ Academic | ❌ | ❌ |
| `registrar` | ❌ Generate | ❌ | ✅ Student-related | ✅ All | ✅ Read-only | ❌ | ❌ |
| `accountant` | ❌ | ✅ All receipts | ❌ | ❌ | ❌ | ✅ All | ✅ All |
| `teacher` | ❌ | ❌ | ❌ | ⚠️ Own students only* | ⚠️ Own subjects only* | ❌ | ❌ |
| `parent` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

\* *Teacher scope requires teacher portal to be implemented. In Phase 14 MVP, teacher is blocked from all PDF exports in the admin system. Re-enable after teacher portal exists.*

### 7.2 Forbidden Message
When a role attempts a disallowed PDF export:
```
غير مسموح: لا تملك صلاحية تصدير PDF
```

### 7.3 Implementation Pattern
- **Frontend:** Check `user.role_key` before rendering print buttons. Disable/hide buttons for disallowed roles.
- **Backend:** Every new PDF API endpoint must include a role-check middleware. Return `403` with the forbidden message for unauthorized roles.
- **Existing endpoints** (`/api/result-cards`, `/api/fee-receipts`) already have school_id filtering but may need role-check strengthening for Phase 14C finance endpoints.

---

## 8. Settings / Snapshot Integration

### 8.1 Settings Used in PDF Generation

| Setting Field | Used In | Source |
|---------------|---------|--------|
| `logo_url` | All documents | Live settings |
| `official_stamp_url` | All documents | Live settings |
| `use_school_logo_on_docs` | All documents | Live settings |
| `use_school_stamp_on_docs` | All documents | Live settings |
| `result_card_header_text` | Result cards | Live settings OR card snapshot |
| `result_card_footer_text` | Result cards | Live settings OR card snapshot |
| `receipt_footer_text` | Receipts | Live settings OR receipt snapshot |
| `official_book_header_text` | Official books | Live settings OR book snapshot |
| `official_book_footer_text` | Official books | Live settings OR book snapshot |
| `verification_note_text` | All documents | Live settings |
| `default_print_size` | Result cards, lists | Live settings |
| `default_receipt_size` | Receipts | Live settings |
| `use_arabic_indic_digits` | All documents | Live settings |
| `date_format` | All documents | Live settings |
| `currency_label` | Receipts, finance | Live settings |

### 8.2 Snapshot Priority Rule
For documents that already have stored snapshots (Result Cards, Receipts, Official Books):
1. **First priority:** Use the document's own snapshot (e.g., `result_card.settings_snapshot_json`).
2. **Second priority:** Use current live settings if snapshot is missing or incomplete.
3. **Never mutate** existing snapshots after generation.

For new list/reports (Student Lists, Grade Sheets, Finance Reports) that do not have per-document snapshots:
1. Use **current live settings** at the time of print.
2. Optionally store a **settings hash** in `print_records.printer_info_json` for audit.

### 8.3 Settings Fetch Strategy
- The `usePrintExport` hook should fetch settings once per print session (or use cached settings from the app's global context if available).
- Settings should be passed as a `snapshot` object to `PrintLayout`, `DocumentHeader`, and `DocumentFooter`.

---

## 9. Print Records Integration

### 9.1 Current Schema
```sql
CREATE TABLE print_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  document_id INTEGER,
  print_type TEXT NOT NULL,       -- 'official_book', 'result_card', 'receipt', ...
  printed_at INTEGER NOT NULL,    -- unixepoch
  printed_by_user_id INTEGER,
  printer_info_json TEXT,         -- JSON with device/agent info
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 9.2 Proposed Extension (Optional, Phase 14B)
To support list/reports that don't have a single `document_id`, add nullable columns or use JSON:
```sql
-- Option A: Keep schema, use document_id = 0 for lists, encode list type in print_type
-- Option B: Add columns (recommended for future)
ALTER TABLE print_records ADD COLUMN source_type TEXT;      -- 'result_card', 'receipt', 'official_book', 'student_list', 'grade_sheet', 'finance_report', 'salary_report'
ALTER TABLE print_records ADD COLUMN source_id INTEGER;     -- document ID if applicable, NULL for lists
ALTER TABLE print_records ADD COLUMN copies_count INTEGER DEFAULT 1;
ALTER TABLE print_records ADD COLUMN notes TEXT;            -- e.g., "Section A, Grade 5"
```

**Recommended for Phase 14A:** Keep the existing schema. For individual documents, use `document_id` + `print_type`. For list prints (Phase 14B), use `document_id = 0` and encode the list filter in `printer_info_json` (e.g., `{"section_id": 5, "class_id": 2}`).

### 9.3 Print Record Trigger Strategy
- **Not every preview should create a record.** Only actual print/save actions.
- **API-first approach:** Before opening the print dialog, call `POST /api/print-records` to create the record. If the API fails, still allow the print (degraded mode) but show a warning.
- **For batch exports:** Create one print record per batch (not per student/receipt).
- **For official books:** Keep existing `printOfficialBook()` API behavior (record then print).

### 9.4 `printer_info_json` Contents
```json
{
  "user_agent": "Mozilla/5.0...",
  "paper_size": "A4",
  "copies": 1,
  "list_filters": { "section_id": 5, "class_id": 2 },
  "settings_hash": "sha256_of_settings_json"
}
```

---

## 10. Frontend Structure

### 10.1 New Files (Phase 14A)

```
src/components/print/
├── PrintLayout.tsx
├── DocumentHeader.tsx
├── DocumentFooter.tsx
├── QRBlock.tsx
├── PrintableTable.tsx
├── PrintButton.tsx
├── usePrintExport.ts
└── printStyles.ts

src/modules/printViews/
├── PrintSectionResultCardsPage.tsx   (new route page)
├── PrintStudentListPage.tsx           (new route page, Phase 14B)
├── PrintGradeSheetPage.tsx            (new route page, Phase 14B)
├── PrintFeesReportPage.tsx            (new route page, Phase 14C)
├── PrintTreasuryReportPage.tsx        (new route page, Phase 14C)
└── PrintSalariesReportPage.tsx        (new route page, Phase 14C)

src/modules/resultCards/
├── ResultCardsPage.tsx                (MODIFY: refactor print to use usePrintExport + PrintLayout)

src/modules/officialBooks/
├── OfficialBooksPage.tsx              (MODIFY: refactor PrintPreview to use PrintLayout + DocumentHeader/Footer)

src/modules/fees/
├── FeesPage.tsx                       (MODIFY: add receipt print handler using PrintLayout)

src/lib/api.ts                         (MODIFY: add createPrintRecord, getSectionResultCards, etc.)
```

### 10.2 Component Contracts

**PrintLayout**
```tsx
<PrintLayout
  paperSize={snapshot.default_print_size || 'A4'}
  showLogo={snapshot.use_school_logo_on_docs}
  showStamp={snapshot.use_school_stamp_on_docs}
  settings={snapshot}
>
  <DocumentHeader settings={snapshot} title="كارت نتيجة" />
  {children}
  <DocumentFooter settings={snapshot} documentNumber={card.card_number} />
  <QRBlock value={verificationUrl} note={snapshot.verification_note_text} />
</PrintLayout>
```

**PrintButton**
```tsx
<PrintButton
  onPrint={() => handlePrint()}
  onRecordPrint={() => createPrintRecord({ ... })}
  label="طباعة / حفظ PDF"
  allowedRoles={['system_admin', 'school_owner', 'principal', 'vice_principal']}
  userRole={user.role_key}
/>
```

### 10.3 Arabic-Indic Digits Integration
- The `toArabicDigits` utility (`src/lib/arabicDigits.ts`) is already used in ResultCardsPage.
- All print components should accept a `useArabicIndic` boolean and wrap displayed numbers through `toArabicDigits`.
- Numbers inside tables (grades, amounts, IDs) must be converted.
- Document numbers and receipt numbers should be converted if setting is enabled.
- **Do NOT convert** QR code raw values (the QR must encode the original ASCII token for verification to work).

---

## 11. Dependencies Decision

### 11.1 Phase 14A: No New Dependencies
- **Do NOT add `jsPDF`, `html2canvas`, `html2pdf.js`, `puppeteer`, or any PDF library.**
- The existing browser print approach is sufficient.
- Existing dependencies are enough: `react`, `qrcode.react`, `lucide-react`.

### 11.2 Phase 14B/C: Optional Dependencies (if needed)
If batch printing of 50+ pages becomes problematic in browser print dialogs, consider:
| Library | Purpose | Size | When to Add |
|---------|---------|------|-------------|
| `html2canvas` | Canvas screenshot for complex graphics | ~150 kB | Only if visual charts needed in PDF |
| `jspdf` | Client-side PDF generation | ~280 kB | Only if server-side generation is required later |

**Decision:** Add **none** in Phase 14A. Re-evaluate after Phase 14A QA if user feedback demands true PDF download files (not print-to-PDF).

### 11.3 Google Fonts
- Continue using `https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap` via `@import` in the print window HTML string.
- No npm package needed.

---

## 12. Test Plan

### 12.1 Phase 14A Test Cases

| # | Test | Method | Expected |
|---|------|--------|----------|
| 1 | Arabic RTL rendering | Print preview → visual inspection | Text flows RTL, columns reversed correctly |
| 2 | Cairo font loading | Print preview → check font family | All text in Cairo, no fallback to system font |
| 3 | Logo rendering | Enable logo in settings → print | Logo appears at top center, not broken |
| 4 | Stamp rendering | Enable stamp in settings → print | Stamp appears in footer, not broken |
| 5 | QR code scanning | Print → scan with phone | QR resolves to correct verification URL |
| 6 | Result card print | Generate card → print button | Popup opens, content matches card data, record created |
| 7 | Receipt print | Generate receipt → print button | Popup opens, receipt data correct, footer text appears |
| 8 | Official book print | Create book → print button | Modal print works, snapshot settings used, record created |
| 9 | Section result cards | Select section → batch print | Route page loads all section cards, paginated for print |
| 10 | Arabic-Indic digits | Enable setting → print numbers | Digits display as ٠١٢٣٤٥٦٧٨٩ |
| 11 | A4 paper size | Select A4 → print preview | Content fits 210mm width |
| 12 | A5 paper size | Select A5 → print preview | Content fits 148mm width |
| 13 | RBAC — accountant | Accountant tries result card print | Button hidden / 403 error |
| 14 | RBAC — teacher | Teacher tries finance print | Button hidden / 403 error |
| 15 | Print record created | Print any document | `print_records` row inserted with correct type, user, timestamp |
| 16 | Cross-school safety | Change school_id param in API | 403 or empty data, no cross-school leak |
| 17 | Build check | `npm run build` | 0 errors, bundle size < 800 kB |
| 18 | TypeScript check | `npx tsc --noEmit` | 0 errors |
| 19 | Settings snapshot | Print result card → verify settings | Snapshot values used, not current live settings |

### 12.2 Phase 14B/C Test Cases

| # | Test | Phase |
|---|------|-------|
| 20 | Student list PDF by class | 14B |
| 21 | Grade sheet PDF by subject | 14B |
| 22 | Failed students PDF | 14B |
| 23 | Exempt students PDF | 14B |
| 24 | Fees summary PDF | 14C |
| 25 | Treasury daily report PDF | 14C |
| 26 | Salary report PDF | 14C |
| 27 | RBAC — registrar access | 14B |
| 28 | Large batch print (50+ students) | 14B |

---

## 13. Risks and Limitations

### 13.1 Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Browser print dialog varies by OS** | Chrome/macOS print dialog looks different from Windows; users may be confused | Provide clear instructions: "اضغط Ctrl+P ثم اختر 'Save as PDF'" |
| **Popup blockers** | `window.open` may be blocked | Use `window.open` with user gesture (button click); fallback to `window.print()` inline |
| **Google Fonts offline** | If network is down, Cairo won't load | Use `font-display: swap` and system Arabic fallback (`Tahoma`, `Arial`) |
| **Large batch prints** | 50+ result cards in one page may crash browser | Paginate batch prints; split into multiple pages with page breaks (`page-break-after: always`) |
| **Image CORS for logo/stamp** | Logo URL may block cross-origin image loading in print | Use `crossOrigin="anonymous"` on `<img>` tags; ensure logo is hosted on same domain or CORS-enabled |
| **Teacher scope not yet implemented** | Teacher role can't access meaningful PDFs until teacher portal exists | Block teacher from PDF exports in admin; document as known limitation |
| **No true PDF file download** | Users get "Save as PDF" from browser, not a `.pdf` download | Accept as MVP limitation; revisit if user demand is high |

### 13.2 Limitations
- **No server-side PDF generation.** Email attachments of PDFs are not possible in this architecture.
- **No digital signatures.** PDFs are not cryptographically signed.
- **Print CSS is not 100% identical across browsers.** Chrome/Firefox/Edge are supported; Safari may have minor alignment differences.
- **QR codes are SVG.** They print sharply, but if the user copies content and pastes into Word, the QR may not copy.
- **Batch exports** are limited by browser memory. Extremely large schools (500+ students in one section) may need server-side pagination or chunked generation in a future phase.

---

## 14. Recommended Implementation Phases

### Phase 14A — Core Document Print Refactor (Estimated: 1–2 weeks)
**Goal:** Standardize existing print implementations into the reusable architecture, and add batch result card print.

**Tasks:**
1. Create `src/components/print/` shared components (`PrintLayout`, `DocumentHeader`, `DocumentFooter`, `QRBlock`, `PrintableTable`, `usePrintExport`, `printStyles.ts`).
2. Refactor `ResultCardsPage.tsx` to use `usePrintExport` + `PrintLayout`.
3. Add `markResultCardPrinted` API call before result card print (currently missing).
4. Add `printReceipt` API and receipt print handler in `FeesPage.tsx`.
5. Refactor `OfficialBooksPage.tsx` `PrintPreview` to use `PrintLayout` + `DocumentHeader` + `DocumentFooter`.
6. Create `/print/result-cards/section/:sectionId` route page for batch section result cards.
7. Add `POST /api/print-records` generic endpoint.
8. Add role checks on all print APIs.
9. QA: Arabic RTL, logo, stamp, QR, print records, RBAC, build.
10. Commit and tag `phase-14a-approved`.

**Deliverables:**
- Individual result card print (refactored)
- Section result cards print (new)
- Individual receipt print (new)
- Official book print (refactored)
- Print records for all four document types
- Shared print component library

---

### Phase 14B — Lists & Grade Sheets (Estimated: 1 week)
**Goal:** Add student lists, grade sheets, and academic reports.

**Tasks:**
1. Create `/print/students` route page with filters (class, section, contact list, subjects list).
2. Create `/print/grades` route page with filters (class, section, subject, failed, exempt, annual summary).
3. Add backend aggregation endpoints for grade summaries and failed/exempt lists.
4. Add `PrintableTable` enhancements for multi-page tables with repeated headers.
5. QA: Large lists, Arabic headers, pagination, RBAC for registrar.
6. Commit and tag `phase-14b-approved`.

**Deliverables:**
- Student list PDF (by class/section)
- Student contact list PDF
- Student subjects list PDF
- Grade sheet by class/section/subject PDF
- Student annual grade summary PDF
- Failed/completion students PDF
- Exempt students PDF

---

### Phase 14C — Finance & Salary Reports (Estimated: 1 week)
**Goal:** Add finance and HR reports with strict accountant-only RBAC.

**Tasks:**
1. Create `/print/fees`, `/print/treasury`, `/print/salaries` route pages.
2. Add backend report endpoints: fees summary, unpaid students, treasury daily/monthly, employee list, salary monthly.
3. Add `currency_label` formatting to all finance print components.
4. Add strict RBAC: accountant/school_owner only; teacher/parent blocked.
5. QA: Finance data accuracy, currency formatting, date ranges, RBAC.
6. Commit and tag `phase-14c-approved`.

**Deliverables:**
- Fees summary PDF
- Unpaid students PDF
- Paid receipts list PDF
- Treasury daily report PDF
- Treasury monthly report PDF
- Employees list PDF
- Salaries by month PDF
- Paid/unpaid salary report PDF

---

### Phase 14D (Optional) — True PDF Downloads
**Goal:** If user feedback demands `.pdf` file downloads instead of browser print-to-PDF.

**Trigger:** Only after Phase 14C is approved and users explicitly request file downloads.

**Approach:** Evaluate `html2canvas` + `jspdf` for client-side generation, or a lightweight server-side micro-service (outside Cloudflare Workers) if quality is insufficient.

**Decision:** Defer to Phase 14D or later. Not in current plan.

---

## Appendix: Settings Snapshot Example

```json
{
  "school_name": "مدرسة النور",
  "principal_name": "أحمد محمد",
  "logo_url": "https://cdn.example.com/logo.png",
  "stamp_url": "https://cdn.example.com/stamp.png",
  "use_logo": true,
  "use_stamp": true,
  "header_text": "بسم الله الرحمن الرحيم",
  "footer_text": "توقيع المدير",
  "verification_note": "صادق من النظام",
  "date_format": "YYYY-MM-DD",
  "use_arabic_indic_digits": true,
  "paper_size": "A4",
  "currency_label": "ج.م"
}
```

---

## Approval Checklist

- [ ] Section 1: Existing findings are accurate and complete
- [ ] Section 2: Browser print approach is accepted (no PDF library for MVP)
- [ ] Section 3: Reusable component architecture is approved
- [ ] Section 4: Document type priorities are correct
- [ ] Section 5: Route plan is acceptable (modal vs. separate routes)
- [ ] Section 6: API requirements are complete and feasible
- [ ] Section 7: RBAC rules are correct for all roles
- [ ] Section 8: Settings/snapshot integration logic is correct
- [ ] Section 9: Print records integration is acceptable
- [ ] Section 10: Frontend structure is reasonable
- [ ] Section 11: No new dependencies for Phase 14A is accepted
- [ ] Section 12: Test plan covers all critical paths
- [ ] Section 13: Risks are understood and acceptable
- [ ] Section 14: Phase breakdown is reasonable and prioritized correctly

**Action required:** Reply with "Phase 14 plan approved — proceed with Phase 14A implementation" or provide corrections.
