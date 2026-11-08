/**
 * Contract wording, generated from the booking itself.
 *
 * The text produced here is stored on the contract row as terms_snapshot, so the
 * agreement can be reproduced exactly as it was signed even after the wording
 * below changes. Bump TERMS_VERSION whenever it does.
 */

import { peso, shortDate } from './format';

export const TERMS_VERSION = 'v1';

export type RentalTermsInput = {
  signatoryName: string;
  equipmentName: string;
  unitCode: string | null;
  startDate: string;
  endDate: string;
  days: number;
  ratePerDay: number;
  total: number;
};

export const rentalTerms = (input: RentalTermsInput) =>
  [
    `EQUIPMENT RENTAL AGREEMENT (${TERMS_VERSION})`,
    '',
    'Between FarmVest, owner and operator of the equipment ("FarmVest"), and',
    `${input.signatoryName} ("the Renter").`,
    '',
    '1. EQUIPMENT',
    `   ${input.equipmentName}${input.unitCode ? ` (unit ${input.unitCode})` : ''}.`,
    '',
    '2. RENTAL PERIOD AND FEE',
    `   ${shortDate(input.startDate)} to ${shortDate(input.endDate)}, ${input.days} day(s)`,
    `   at ${peso(input.ratePerDay)} per day. Total rental fee: ${peso(input.total)}.`,
    '   The fee is payable on delivery unless FarmVest agrees otherwise in writing.',
    '',
    '3. DELIVERY AND RETURN',
    '   FarmVest delivers the unit on the start date and collects it on the return',
    '   date. The Renter shall have the unit available for collection on that date.',
    '',
    '4. CONDITION AND LIABILITY FOR DAMAGE',
    '   The unit is released in working condition. The Renter is responsible for',
    '   damage beyond normal wear and tear, including loss or non-return, and',
    '   agrees to pay the repair or replacement cost assessed by FarmVest at the',
    '   return inspection. Mechanical failure that is not caused by misuse is',
    '   carried by FarmVest.',
    '',
    '5. OPERATION AND FUEL',
    '   The Renter provides fuel and a competent operator, and shall use the unit',
    '   only for its intended agricultural purpose and only on the declared farm.',
    '',
    '6. LATE RETURN',
    '   A unit kept beyond the return date is charged at the daily rate for each',
    '   additional day.',
    '',
    '7. WEATHER ADVISORY',
    '   FarmVest may place this booking on hold or reschedule it when a severe',
    '   weather advisory covers the farm location. No penalty applies to either',
    '   party for a booking postponed on this ground.',
    '',
    '8. CANCELLATION',
    '   Either party may cancel before the start date. FarmVest may cancel at any',
    '   time if the unit becomes unsafe to operate.',
    '',
    '9. DISPUTES',
    '   A disagreement over a damage assessment may be raised with the FarmVest',
    '   administrator, who reviews the inspection record and decides the case.',
    '',
    `Signed electronically by ${input.signatoryName}.`,
  ].join('\n');

export type InvestmentTermsInput = {
  signatoryName: string;
  projectTitle: string;
  farmOwnerName: string;
  category: string;
  amount: number;
  fundingGoal: number;
  /** Return the farm owner undertakes to pay on top of the amount. */
  roiPercent: number;
  expectedReturn: number;
  cycleDays: number | null;
  collateralType: string;
  collateralDescription: string;
  collateralValue: number;
};

/**
 * The funding agreement.
 *
 * This used to be an investment agreement, and said so: no return was promised,
 * and an ordinary farming loss was carried by the investor. It is now a secured
 * obligation. The farm owner undertakes to repay the amount with a stated
 * return, and pledges an asset the investor can pursue if they do not.
 *
 * That is a real change in what FarmVest is, and the wording has to carry it
 * honestly. Section 4 is the one that matters: the farm owner owes the money
 * back whether the cycle succeeded or not, and the pledged asset is what stands
 * behind that. Section 7 says the part people forget to ask about -- the debt
 * does not die with the borrower.
 *
 * FarmVest records the agreement and holds the documents. It does not lend its
 * own money and it does not foreclose: recovery is a legal matter between the
 * two parties, and the platform's job is to make it provable.
 */
export const fundingTerms = (input: InvestmentTermsInput) =>
  [
    `LIVESTOCK FUNDING AGREEMENT (${TERMS_VERSION})`,
    '',
    `Between ${input.signatoryName} ("the Funder") and ${input.farmOwnerName}`,
    '("the Farm Owner"), recorded through FarmVest, which operates the platform.',
    '',
    '1. THE PROJECT',
    `   ${input.projectTitle} (${input.category}).`,
    `   Funding goal: ${peso(input.fundingGoal)}.`,
    '',
    '2. AMOUNT AND RETURN',
    `   The Funder provides ${peso(input.amount)}.`,
    `   The Farm Owner undertakes to repay ${peso(input.expectedReturn)}, being the`,
    `   amount provided plus ${input.roiPercent}%.`,
    input.cycleDays
      ? `   Expected within ${input.cycleDays} days of the project being fully funded.`
      : '   No fixed term is stated.',
    '   The period runs from full funding, not from the date of this agreement,',
    '   because the cycle cannot begin until the project is funded.',
    '   The repayment, together with FarmVest\'s commission, is paid in one',
    '   transfer to FarmVest\'s account, and FarmVest pays the Funder from it. A',
    '   payment made to the Funder directly does not discharge this obligation or',
    '   the commission.',
    '',
    '3. RELEASE OF FUNDS',
    '   Funds reach the Farm Owner in one full release once the project is fully',
    '   funded, with nothing deducted. Until then FarmVest holds them, and they',
    '   are refunded to investors if the project does not fund. FarmVest\'s 5%',
    '   commission on the amount raised is paid by the Farm Owner together with',
    '   the repayment, after the harvest is sold.',
    '',
    '4. THE OBLIGATION IS NOT CONDITIONAL ON THE HARVEST',
    '   The Farm Owner owes the amount in section 2 whether or not the cycle',
    '   succeeds. Disease, weather, accident, the death of livestock and a fall in',
    '   price are the Farm Owner’s risk, not the Funder’s. A failed cycle',
    '   reduces nothing that is owed.',
    '',
    '5. SECURITY',
    `   The Farm Owner pledges: ${input.collateralType}.`,
    `   ${input.collateralDescription}`,
    `   Declared value: ${peso(input.collateralValue)}.`,
    '   The pledge secures this agreement and every other agreement on the same',
    '   project, in proportion to each amount provided. The Farm Owner states that',
    '   the asset is theirs to pledge and is not already pledged elsewhere.',
    '',
    '6. IF THE FARM OWNER DOES NOT PAY',
    '   The Funder may pursue the pledged asset through the ordinary legal process.',
    '   FarmVest is not a party to that process, does not act for either side, and',
    '   does not take possession of anything. It holds the documents filed here and',
    '   will produce them on request.',
    '',
    '7. DEATH OR INCAPACITY OF THE FARM OWNER',
    '   The obligation does not end. It passes to the Farm Owner’s estate, and the',
    '   pledged asset remains security for it.',
    '',
    '8. WHAT FARMVEST DOES AND DOES NOT DO',
    '   FarmVest verifies the identity of both parties, reviews the documents filed',
    '   with the project, holds the staged release, records this agreement, and',
    '   decides disputes about the record. FarmVest does not lend its own money,',
    '   does not guarantee repayment, does not value the pledged asset, and gives',
    '   no financial advice. The declared value in section 5 is the Farm Owner’s',
    '   statement, not FarmVest’s assessment.',
    '',
    '9. MISCONDUCT',
    '   Where a loss is caused by misuse of funds, misrepresentation, a pledge of an',
    '   asset the Farm Owner does not own, or falsified progress evidence, the',
    '   Funder may raise a case. FarmVest may freeze the project, halt any further',
    '   release, and decide the matter on the record.',
    '',
    '10. MONITORING',
    '   The Funder may view the progress updates for this project for as long as it',
    '   runs, and may raise a case from any update.',
    '',
    '11. WITHDRAWAL',
    '   An amount provided cannot be withdrawn once given. If the project is',
    '   cancelled before completion, funds not yet released are returned and the',
    '   obligation is reduced accordingly.',
    '',
    `Signed electronically by ${input.signatoryName}.`,
  ].join('\n');

/** Kept so existing imports keep working while the name settles. */
export const investmentTerms = fundingTerms;
