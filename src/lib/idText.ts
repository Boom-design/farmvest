/**
 * Reading the words printed on a government ID.
 *
 * One question only: does the document look like the kind the customer said
 * they were uploading. Someone who picks Passport from the list and uploads a
 * Postal ID is the case this catches -- usually carelessness, occasionally not.
 *
 * It is deliberately advisory. OCR on a photographed Philippine ID fails often:
 * laminate glare, holograms over the text, a dozen different typefaces, and a
 * card held at an angle. Blocking on a failed read would turn away the honest
 * majority to catch the careless few, so a mismatch flags the verification for
 * an Admin and an unreadable card costs nothing.
 */

import { createWorker } from 'tesseract.js';

/**
 * Words that identify each document, in the order they are worth testing.
 *
 * Taken from the printed headers rather than from anything on the data lines:
 * a header is large, high-contrast and in a fixed place, which is the only part
 * of a photographed card OCR reads with any reliability.
 */
const ID_MARKERS: Record<string, string[]> = {
  Passport: ['PASAPORTE', 'PASSPORT'],
  'Postal ID': ['POSTAL', 'PHLPOST', 'POSTAL CORP'],
  'PhilSys National ID': ['PAMBANSANG PAGKAKAKILANLAN', 'PHILIPPINE IDENTIFICATION', 'PHILSYS'],
  "Driver's License": ['DRIVER', 'LAND TRANSPORTATION', 'LTO'],
  UMID: ['UMID', 'UNIFIED MULTI', 'COMMON REFERENCE'],
  'SSS ID': ['SOCIAL SECURITY', 'SSS'],
  'GSIS ID': ['GOVERNMENT SERVICE INSURANCE', 'GSIS'],
  "Voter's ID": ['COMMISSION ON ELECTIONS', 'COMELEC', 'VOTER'],
  'PRC ID': ['PROFESSIONAL REGULATION', 'PRC'],
  'Senior Citizen ID': ['SENIOR CITIZEN', 'OSCA'],
};

export type IdTextCheck =
  | { verdict: 'match'; found: string }
  /** Another document's marker was read instead of the expected one. */
  | { verdict: 'mismatch'; looksLike: string; found: string }
  /** Nothing decisive was read. Not a failure: most photographed cards land here. */
  | { verdict: 'unreadable' };

/** Collapses the usual OCR noise so a marker still matches. */
const normalise = (text: string) =>
  text
    .toUpperCase()
    // A card is read in bands, and a header can arrive split across lines.
    .replace(/\s+/g, ' ')
    // 0/O and 1/I are the two substitutions tesseract makes most on a laminate.
    .replace(/0/g, 'O')
    .replace(/1/g, 'I');

/**
 * Read the card and say whether it looks like the declared type.
 *
 * The worker is created and destroyed per call. A long-lived one would be
 * faster, but this runs once per verification and a worker left alive holds
 * about 30 MB for the rest of the session.
 */
export const checkIdType = async (
  file: File,
  declaredType: string
): Promise<IdTextCheck> => {
  const expected = ID_MARKERS[declaredType];
  if (!expected) return { verdict: 'unreadable' };

  const worker = await createWorker('eng');

  try {
    const { data } = await worker.recognize(file);
    const text = normalise(data.text ?? '');

    for (const marker of expected) {
      if (text.includes(normalise(marker))) return { verdict: 'match', found: marker };
    }

    // Nothing expected was found. Before calling it a mismatch, check whether
    // some other document's marker is in there: an unreadable card and a card
    // that is plainly something else deserve different answers.
    for (const [type, markers] of Object.entries(ID_MARKERS)) {
      if (type === declaredType) continue;

      for (const marker of markers) {
        if (text.includes(normalise(marker))) {
          return { verdict: 'mismatch', looksLike: type, found: marker };
        }
      }
    }

    return { verdict: 'unreadable' };
  } catch {
    // A failed read is the expected outcome often enough that it is not worth
    // reporting. The face match is the check that matters.
    return { verdict: 'unreadable' };
  } finally {
    await worker.terminate();
  }
};
