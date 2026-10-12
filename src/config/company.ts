import { env } from './env';

/**
 * Legal identity printed on receipts, invoices and prescriptions. Set these in
 * the environment — the GSTIN is only printed when a real one is configured,
 * never a sample value.
 */
export const COMPANY = {
  legalName: env.COMPANY_LEGAL_NAME ?? 'VidhyaCare Health Services Pvt Ltd',
  gstin: env.COMPANY_GSTIN ?? null,
  address: env.COMPANY_ADDRESS ?? '311 Alok Nagar, Musakhedi, Indore, M.P. 452001',
};
