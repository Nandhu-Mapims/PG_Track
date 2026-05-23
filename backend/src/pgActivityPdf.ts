import PDFDocument from "pdfkit";

type PdfDoc = InstanceType<typeof PDFDocument>;

export type PgActivityPdfMeta = {
  pgName: string;
  departmentName: string;
  dateRangeLabel: string;
  activityTypeFilter?: string;
};

export type PgActivityPdfRow = {
  sortAt: number;
  whenLabel: string;
  activity: string;
  pg?: string;
  remarks?: string;
};

export type PgActivityPdfGroup = {
  patient: string;
  ipNumber: string;
  department: string;
  rows: PgActivityPdfRow[];
};

export type PgActivityPdfOptions = {
  meta: PgActivityPdfMeta;
  groups: PgActivityPdfGroup[];
  generatedAt?: Date;
};

const palette = {
  primary: "#0f766e",
  primaryDark: "#134e4a",
  primaryLight: "#ccfbf1",
  white: "#ffffff",
  ink: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  border: "#e2e8f0",
  patientBg: "#f0fdfa",
  sectionBg: "#f8fafc",
  timelineLine: "#99f6e4",
};

const layout = {
  margin: 40,
  footerTopOffset: 42,
  contentBottomPad: 56,
  timelineDotX: 52,
  textLeft: 68,
  gapAfterPatient: 20,
  gapAfterSectionTitle: 12,
  gapBetweenPatients: 28,
};

const maxPdfActivities = 120;

function contentWidth(doc: PdfDoc): number {
  return doc.page.width - layout.margin * 2;
}

function textRight(doc: PdfDoc): number {
  return doc.page.width - layout.margin;
}

function textColumnWidth(doc: PdfDoc): number {
  return textRight(doc) - layout.textLeft;
}

function pageBottom(doc: PdfDoc): number {
  return doc.page.height - layout.contentBottomPad;
}

/** Always sync PDFKit flow cursor to our layout Y (prevents overlapping sections). */
function atY(doc: PdfDoc, y: number): number {
  doc.x = layout.margin;
  doc.y = y;
  return y;
}

function drawLabelValue(doc: PdfDoc, label: string, value: string, x: number, y: number, labelW: number, valueW: number): void {
  doc.font("Helvetica").fontSize(10).fillColor(palette.muted);
  doc.text(`${label}:`, x, y, { width: labelW, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(palette.body);
  doc.text(value, x + labelW, y, { width: valueW, lineBreak: false });
}

function drawRoundedRect(
  doc: PdfDoc,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string,
): void {
  doc.save();
  doc.roundedRect(x, y, w, h, r);
  if (stroke) doc.fillAndStroke(fill, stroke);
  else doc.fill(fill);
  doc.restore();
}

export function formatTimelineWhen(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.getDate();
  const month = d.toLocaleString("en-IN", { month: "short" });
  const year = d.getFullYear();
  const time = d
    .toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s/g, " ")
    .trim();
  return `${day} ${month} ${year} • ${time}`;
}

export function formatReportDateRange(from?: string, to?: string): string {
  const parse = (raw?: string) => {
    if (!raw?.trim()) return null;
    const d = new Date(raw.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const start = parse(from);
  const end = parse(to);
  const part = (d: Date, withYear: boolean) =>
    d.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    });

  if (start && end) {
    return `${part(start, false)} – ${part(end, true)}`;
  }
  if (start) return `From ${part(start, true)}`;
  if (end) return `Until ${part(end, true)}`;
  return "All dates";
}

type ActivityVisual = { fill: string; mark: string };

function activityVisual(activity: string): ActivityVisual {
  const key = activity.trim().toLowerCase();
  if (key.includes("admission")) return { fill: palette.primary, mark: "A" };
  if (key.includes("consultant") || key.includes("round")) return { fill: "#0284c7", mark: "R" };
  if (key.includes("procedure")) return { fill: "#7c3aed", mark: "P" };
  if (key.includes("progress")) return { fill: "#0891b2", mark: "N" };
  if (key.includes("icu")) return { fill: "#dc2626", mark: "I" };
  if (key.includes("discharge")) return { fill: "#059669", mark: "D" };
  if (key.includes("emergency")) return { fill: "#ea580c", mark: "E" };
  if (key.includes("referral")) return { fill: "#ca8a04", mark: "F" };
  return { fill: palette.muted, mark: "•" };
}

function formatGeneratedAt(date: Date): string {
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function drawReportHeader(doc: PdfDoc, meta: PgActivityPdfMeta): number {
  const left = layout.margin;
  const width = contentWidth(doc);
  let y = layout.margin;

  doc.font("Helvetica-Bold").fontSize(22).fillColor(palette.ink);
  doc.text("PG Activity Report", left, y, { width, lineBreak: false });
  y += 32;

  const rows: { label: string; value: string }[] = [
    { label: "PG", value: meta.pgName },
    { label: "Department", value: meta.departmentName },
    { label: "Date Range", value: meta.dateRangeLabel },
  ];
  if (meta.activityTypeFilter) {
    rows.push({ label: "Activity", value: meta.activityTypeFilter });
  }

  for (const row of rows) {
    drawLabelValue(doc, row.label, row.value, left, y, 92, width - 92);
    y += 20;
  }

  doc.save();
  doc.moveTo(left, y + 6).lineTo(textRight(doc), y + 6).lineWidth(1).strokeColor(palette.border).stroke();
  doc.restore();

  return atY(doc, y + 20);
}

function drawContinuationHeader(doc: PdfDoc): number {
  const left = layout.margin;
  const width = contentWidth(doc);
  const top = layout.margin;
  drawRoundedRect(doc, left, top, width, 32, 6, palette.primaryLight, palette.border);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(palette.primaryDark);
  doc.text("PG Activity Report (continued)", left + 12, top + 10, { width: width - 24, lineBreak: false });
  return atY(doc, top + 44);
}

function ensureSpace(doc: PdfDoc, y: number, needed: number): number {
  if (y + needed <= pageBottom(doc)) return atY(doc, y);
  doc.addPage();
  return drawContinuationHeader(doc);
}

function measureWrappedHeight(doc: PdfDoc, text: string, width: number, fontSize: number): number {
  doc.font("Helvetica").fontSize(fontSize);
  return doc.heightOfString(text, { width, lineGap: 2 });
}

function measureTimelineEntryHeight(doc: PdfDoc, row: PgActivityPdfRow, showPg: boolean): number {
  let h = 38;
  if (showPg && row.pg) h += 14;
  const remarks = normalizeRemarks(row.remarks);
  if (remarks) {
    h += measureWrappedHeight(doc, remarks, textColumnWidth(doc), 8.5) + 4;
  }
  return h + 10;
}

function normalizeRemarks(remarks?: string): string | null {
  const value = String(remarks ?? "").trim();
  if (!value || value === "-" || /^no remarks?$/i.test(value)) return null;
  return value;
}

function drawPatientBlock(doc: PdfDoc, group: PgActivityPdfGroup, top: number): number {
  const left = layout.margin;
  const width = contentWidth(doc);
  const blockH = 78;
  const midX = left + width / 2;

  drawRoundedRect(doc, left, top, width, blockH, 8, palette.patientBg, palette.border);
  doc.save();
  doc.rect(left, top + 6, 4, blockH - 12).fill(palette.primary);
  doc.restore();

  doc.font("Helvetica").fontSize(8).fillColor(palette.muted);
  doc.text("Patient", left + 16, top + 10, { lineBreak: false });

  doc.font("Helvetica-Bold").fontSize(14).fillColor(palette.ink);
  doc.text(group.patient, left + 16, top + 24, { width: width - 32, lineBreak: false });

  doc.font("Helvetica").fontSize(9.5).fillColor(palette.body);
  doc.text(`IP: ${group.ipNumber}`, left + 16, top + 46, { width: width / 2 - 24, lineBreak: false });
  doc.text(`Department: ${group.department}`, midX, top + 46, { width: width / 2 - 16, lineBreak: false });

  return top + blockH + layout.gapAfterPatient;
}

function drawSectionTitle(doc: PdfDoc, title: string, top: number): number {
  const left = layout.margin;
  const width = contentWidth(doc);

  doc.font("Helvetica-Bold").fontSize(11).fillColor(palette.primaryDark);
  doc.text(title, left, top, { width, lineBreak: false });

  const ruleY = top + 18;
  doc.save();
  doc.moveTo(left, ruleY).lineTo(textRight(doc), ruleY).lineWidth(0.5).strokeColor(palette.timelineLine).stroke();
  doc.restore();

  return top + 18 + layout.gapAfterSectionTitle;
}

function drawTimelineEntry(
  doc: PdfDoc,
  row: PgActivityPdfRow,
  top: number,
  isLast: boolean,
  showPg: boolean,
): number {
  const entryH = measureTimelineEntryHeight(doc, row, showPg);
  const dotX = layout.timelineDotX;
  const textLeft = layout.textLeft;
  const textW = textColumnWidth(doc);
  const dotY = top + 12;
  const visual = activityVisual(row.activity);

  doc.save();
  doc.lineWidth(1.5).strokeColor(palette.timelineLine);
  if (!isLast) {
    doc.moveTo(dotX, dotY + 9).lineTo(dotX, top + entryH - 2).stroke();
  }
  doc.restore();

  doc.save();
  doc.circle(dotX, dotY, 7).fill(visual.fill);
  doc.font("Helvetica-Bold").fontSize(7).fillColor(palette.white);
  doc.text(visual.mark, dotX - 7, dotY - 4, { width: 14, align: "center", lineBreak: false });
  doc.restore();

  doc.font("Helvetica").fontSize(9.5).fillColor(palette.muted);
  doc.text(row.whenLabel, textLeft, top + 2, { width: textW, lineBreak: false });

  doc.font("Helvetica-Bold").fontSize(11).fillColor(palette.ink);
  doc.text(row.activity, textLeft, top + 18, { width: textW, lineBreak: false });

  let contentY = top + 34;
  if (showPg && row.pg) {
    doc.font("Helvetica").fontSize(8.5).fillColor(palette.muted);
    doc.text(`PG: ${row.pg}`, textLeft, contentY, { width: textW, lineBreak: false });
    contentY += 14;
  }

  const remarks = normalizeRemarks(row.remarks);
  if (remarks) {
    doc.font("Helvetica").fontSize(8.5).fillColor(palette.muted);
    const remarkH = measureWrappedHeight(doc, remarks, textW, 8.5);
    doc.text(remarks, textLeft, contentY, { width: textW, lineGap: 2 });
    contentY += remarkH;
  }

  return top + entryH;
}

function drawEmptyState(doc: PdfDoc): void {
  const cx = doc.page.width / 2;
  const cy = doc.page.height / 2 - 16;
  drawRoundedRect(doc, cx - 80, cy - 50, 160, 100, 10, palette.sectionBg, palette.border);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(palette.ink);
  doc.text("No activities found", cx - 80, cy - 18, { width: 160, align: "center", lineBreak: false });
  doc.font("Helvetica").fontSize(9.5).fillColor(palette.muted);
  doc.text("Adjust filters and try again.", cx - 80, cy + 4, { width: 160, align: "center", lineBreak: false });
}

export function drawPgActivityPageFooters(doc: PdfDoc, generatedAt: Date): void {
  const range = doc.bufferedPageRange();
  if (!range || range.count === 0) return;

  const stamp = formatGeneratedAt(generatedAt);
  const left = layout.margin;
  const width = contentWidth(doc);
  const total = range.count;

  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    const footerY = doc.page.height - layout.footerTopOffset;
    const savedY = doc.y;
    const savedX = doc.x;

    doc.save();
    doc.moveTo(left, footerY - 8).lineTo(left + width, footerY - 8).lineWidth(0.5).strokeColor(palette.border).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(palette.muted);
    doc.text(`PG Tracking System · Confidential · Generated ${stamp}`, left, footerY, {
      width: width - 70,
      lineBreak: false,
    });
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(palette.primaryDark);
    doc.text(`Page ${i + 1} of ${total}`, left, footerY, { width, align: "right", lineBreak: false });
    doc.restore();

    doc.x = savedX;
    doc.y = savedY;
  }
}

export function renderPgActivityReportPdf(doc: PdfDoc, options: PgActivityPdfOptions): void {
  const { meta, groups } = options;
  const showPgOnTimeline = meta.pgName === "All PGs";

  let y = drawReportHeader(doc, meta);

  if (groups.length === 0) {
    drawEmptyState(doc);
    return;
  }

  let pdfActivitiesDrawn = 0;

  for (let gIndex = 0; gIndex < groups.length; gIndex++) {
    if (pdfActivitiesDrawn >= maxPdfActivities) break;
    const group = groups[gIndex];

    const patientBlockH = 78 + layout.gapAfterPatient;
    const sectionH = 18 + layout.gapAfterSectionTitle;
    y = ensureSpace(doc, y, patientBlockH + sectionH + 48);

    y = drawPatientBlock(doc, group, y);
    y = atY(doc, y);

    y = drawSectionTitle(doc, "Activity Timeline", y);
    y = atY(doc, y);

    const sortedRows = [...group.rows].sort((a, b) => a.sortAt - b.sortAt);
    for (let i = 0; i < sortedRows.length; i++) {
      if (pdfActivitiesDrawn >= maxPdfActivities) break;

      const row = sortedRows[i];
      const entryH = measureTimelineEntryHeight(doc, row, showPgOnTimeline);
      y = ensureSpace(doc, y, entryH + 4);

      const isLast = i === sortedRows.length - 1;
      y = drawTimelineEntry(doc, row, y, isLast, showPgOnTimeline);
      y = atY(doc, y);
      pdfActivitiesDrawn += 1;
    }

    if (gIndex < groups.length - 1) {
      y = atY(doc, y + layout.gapBetweenPatients);
    }
  }

  if (pdfActivitiesDrawn >= maxPdfActivities) {
    y = ensureSpace(doc, y, 24);
    doc.font("Helvetica").fontSize(8.5).fillColor(palette.muted);
    doc.text(
      `Showing first ${maxPdfActivities} activities. Export to Excel for the full dataset.`,
      layout.margin,
      y,
      { width: contentWidth(doc), align: "center", lineBreak: false },
    );
  }
}
