import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CurrentUserProfile } from '../movements';
import type { CalculatorEvaluation } from './pricing';

export interface GenerateInvoicePdfOptions {
  evaluation: CalculatorEvaluation;
  currentUser?: CurrentUserProfile;
  patientName?: string;
  invoiceNumber?: string;
  date?: Date;
}

export function buildDispensaryInvoicePdf(options: GenerateInvoicePdfOptions): jsPDF {
  const {
    evaluation,
    currentUser,
    patientName = '',
    invoiceNumber = `INV-${Date.now().toString().slice(-6)}`,
    date = new Date(),
  } = options;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  // 1. Header Banner line
  doc.setFillColor(14, 116, 144); // sky-700
  doc.rect(margin, 12, pageWidth - margin * 2, 2, 'F');

  // Title & Brand
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(14, 116, 144); // sky-700
  doc.text('PharmaVault Dispensary', margin, 24);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text('Prescription Dispensing Receipt & Tax Invoice', margin, 30);

  // Date / Time & Invoice # (Top Right)
  const dateFormatted = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeFormatted = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const dateTimeString = `${dateFormatted} at ${timeFormatted}`;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(`Invoice #: ${invoiceNumber}`, pageWidth - margin, 24, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Date: ${dateTimeString}`, pageWidth - margin, 30, { align: 'right' });

  // 2. Patient / Order info box
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setFillColor(248, 250, 252); // slate-50
  doc.roundedRect(margin, 36, pageWidth - margin * 2, 22, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105); // slate-600
  doc.text('PATIENT & DISPENSARY DETAILS', margin + 4, 42);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  const patientText = patientName.trim()
    ? `Patient: ${patientName.trim()}`
    : 'Patient: _________________________________________________';
  doc.text(patientText, margin + 4, 49);

  if (currentUser) {
    doc.setTextColor(100, 116, 139);
    doc.text(`Dispensing Pharmacist: ${currentUser.name} (PIN: ${currentUser.pin})`, margin + 4, 55);
  } else {
    doc.setTextColor(100, 116, 139);
    doc.text('Rx / Order Reference: _____________________________________', margin + 4, 55);
  }

  // 3. Table of medication lines (exact deterministic columns: Medication Name, Qty, Unit Price, Line Total)
  const tableHead = [['Medication Name', 'Qty', 'Unit Price', 'Line Total']];
  const tableBody = evaluation.lines.map((line) => {
    const details = [
      line.brandName,
      line.genericName ? `(${line.genericName})` : '',
      line.strength ? line.strength : '',
      line.dosageForm ? line.dosageForm : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return [
      details,
      line.quantity.toString(),
      line.unitPriceFormatted,
      line.lineSubtotalFormatted,
    ];
  });

  autoTable(doc, {
    startY: 63,
    margin: { left: margin, right: margin },
    head: tableHead,
    body: tableBody,
    theme: 'striped',
    headStyles: {
      fillColor: [14, 116, 144], // sky-700
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'left',
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: [30, 41, 59],
    },
    columnStyles: {
      0: { cellWidth: 'auto', halign: 'left' },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 32, halign: 'right' },
      3: { cellWidth: 35, halign: 'right' },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  // 4. Summary section at bottom right: Subtotal, Discount applied, Tax applied, exact Grand Total
  const lastTableY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120;
  const summaryBoxWidth = 85;
  const summaryX = pageWidth - margin - summaryBoxWidth;
  let currentY = lastTableY + 8;

  // Background card for summary
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(summaryX, currentY, summaryBoxWidth, 38, 2, 2, 'FD');

  currentY += 6;
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Subtotal:', summaryX + 4, currentY);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(evaluation.subtotalFormatted, pageWidth - margin - 4, currentY, { align: 'right' });

  currentY += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Discount (${evaluation.discountPercentDisplay}%):`, summaryX + 4, currentY);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  const discountText = `-${evaluation.discountAmountFormatted}`;
  doc.text(discountText, pageWidth - margin - 4, currentY, { align: 'right' });

  currentY += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Tax (${evaluation.taxPercentDisplay}%):`, summaryX + 4, currentY);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  const taxText = `+${evaluation.taxAmountFormatted}`;
  doc.text(taxText, pageWidth - margin - 4, currentY, { align: 'right' });

  // Divider inside summary
  currentY += 3;
  doc.setDrawColor(203, 213, 225);
  doc.line(summaryX + 4, currentY, pageWidth - margin - 4, currentY);

  currentY += 7;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(14, 116, 144);
  doc.text('Grand Total:', summaryX + 4, currentY);
  doc.setTextColor(15, 23, 42);
  doc.text(evaluation.grandTotalFormatted, pageWidth - margin - 4, currentY, { align: 'right' });

  // 5. Footer: "Thank you for your trust. Get well soon."
  const footerY = pageHeight - 14;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('Thank you for your trust. Get well soon.', pageWidth / 2, footerY, { align: 'center' });

  return doc;
}
