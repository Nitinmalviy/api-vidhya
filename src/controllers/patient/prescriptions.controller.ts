import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { Types } from 'mongoose';
import { Prescription } from '../../models/Prescription';
import { Patient } from '../../models/Patient';
import { getPresignedUrl } from '../../services/presignedUrl';
import type { AuthRequest } from '../../types';
import { NotFoundError, UnauthorizedError } from '../../utils/AppError';

const DOCTOR_FIELDS = 'name specializations degreeDetails.degreeName licenseDetails.licenseNumber';

type PopulatedDoctor = {
  _id: Types.ObjectId;
  name?: string;
  specializations?: string[];
  degreeDetails?: { degreeName?: string };
  licenseDetails?: { licenseNumber?: string };
} | null;

function serialize(p: any) {
  const doc = p.doctorId as PopulatedDoctor;
  return {
    id: String(p._id),
    createdAt: p.createdAt,
    medicines: p.medicines as string,
    notes: p.notes ?? null,
    source: p.opdSessionId ? 'LIVE_OPD' : p.appointmentId ? 'APPOINTMENT' : 'DIRECT',
    appointmentId: p.appointmentId ? String(p.appointmentId) : null,
    doctor: doc
      ? {
          id: String(doc._id),
          name: doc.name ?? 'Doctor',
          specialization: doc.specializations?.[0] ?? null,
          degree: doc.degreeDetails?.degreeName ?? null,
        }
      : null,
    attachments: p.attachments as string[],
  };
}

/* GET /api/v1/patient/prescriptions
   Every prescription a doctor has written for the signed-in patient, newest first.
   Attachment links are short-lived signed URLs. */
export const listMyPrescriptions = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const rows = await Prescription.find({ patientId: req.user.id })
    .populate('doctorId', DOCTOR_FIELDS)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const prescriptions = await Promise.all(
    rows.map(async (p) => {
      const s = serialize(p);
      s.attachments = (await Promise.all(s.attachments.map((a) => getPresignedUrl(a)))).filter(Boolean) as string[];
      return s;
    })
  );

  res.status(200).json({ success: true, data: { prescriptions } });
};

/* GET /api/v1/patient/prescriptions/:id/pdf — a printable copy for the chemist. */
export const downloadPrescriptionPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  if (!Types.ObjectId.isValid(req.params.id)) throw new NotFoundError('Prescription');

  const p = await Prescription.findOne({ _id: req.params.id, patientId: req.user.id })
    .populate('doctorId', DOCTOR_FIELDS)
    .lean();
  if (!p) throw new NotFoundError('Prescription');
  const patient = await Patient.findById(req.user.id).select('name gender dateOfBirth').lean();
  const doc = p.doctorId as unknown as PopulatedDoctor;
  const ref = `RX-${String(p._id).slice(-8).toUpperCase()}`;
  const issued = new Date((p as { createdAt?: Date }).createdAt ?? Date.now()).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const pdf = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=prescription-${ref}.pdf`);
  pdf.pipe(res);

  pdf.fontSize(22).fillColor('#2563EB').text('VidhyaCare', { align: 'right' });
  pdf.fontSize(10).fillColor('#56607A').text(`Prescription ${ref} · ${issued}`, { align: 'right' });
  pdf.moveDown(1.5);

  pdf.fillColor('#0F1B2D').fontSize(15).font('Helvetica-Bold').text(doc?.name ?? 'Doctor');
  pdf.font('Helvetica').fontSize(11).fillColor('#334155');
  const docLine = [doc?.specializations?.[0], doc?.degreeDetails?.degreeName].filter(Boolean).join(' · ');
  if (docLine) pdf.text(docLine);
  if (doc?.licenseDetails?.licenseNumber) pdf.text(`Reg. no. ${doc.licenseDetails.licenseNumber}`);
  pdf.moveDown();

  pdf.fillColor('#0F1B2D').text(`Patient: ${patient?.name ?? 'Patient'}`);
  pdf.moveDown();
  pdf.moveTo(50, pdf.y).lineTo(545, pdf.y).strokeColor('#E2E8F0').stroke();
  pdf.moveDown();

  pdf.font('Helvetica-Bold').fontSize(18).fillColor('#1D4ED8').text('Rx');
  pdf.font('Helvetica').fontSize(12).fillColor('#0F1B2D').text(p.medicines, { lineGap: 4 });
  if (p.notes) {
    pdf.moveDown();
    pdf.font('Helvetica-Bold').fontSize(12).text('Advice');
    pdf.font('Helvetica').text(p.notes, { lineGap: 3 });
  }

  pdf.moveDown(3);
  pdf.fontSize(9).fillColor('#56607A').text('Issued digitally through VidhyaCare. Verify at vidhyacare.in.', { align: 'center' });
  pdf.end();
};
