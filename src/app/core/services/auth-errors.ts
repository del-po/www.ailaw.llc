// Firebase error codes → messages a client can act on

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'Email or password is incorrect.',
  'auth/invalid-email': 'This email address is not valid.',
  'auth/email-already-in-use': 'An account with this email already exists. Try logging in.',
  'auth/weak-password': 'Choose a stronger password: at least 8 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/user-disabled': 'This account has been disabled. Contact us for help.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/popup-blocked': 'The browser blocked the Google window. Allow pop-ups and try again.',
  'auth/account-exists-with-different-credential':
    'This email is already registered with another sign-in method.',
  'auth/expired-action-code': 'This link has expired. Request a new one.',
  'auth/invalid-action-code': 'This link is invalid or was already used. Request a new one.',
  'auth/missing-password': 'Enter your current password.',
  'auth/requires-recent-login': 'For your security, log in again and retry.',
  ACCOUNT_SUSPENDED: 'This account is suspended. Contact us for help.',
  EMAIL_NOT_VERIFIED: 'Confirm your email address before ordering.',
  PRODUCT_UNAVAILABLE: 'A service in your cart is no longer available. Remove it and try again.',
  DUPLICATE_ITEM: 'A service appears twice in your cart. Refresh the page and try again.',
  CART_EMPTY: 'Your cart is empty.',
  CART_LIMIT: 'Too many different services in one order.',
  INVALID_QUANTITY: 'Quantities must be between 1 and 20.',
  MIXED_CURRENCIES: 'Services in different currencies have to be ordered separately.',
  INVALID_TEXT: 'Some details are too long or contain invalid characters.',
  ACCOUNT_INACTIVE: 'This account is suspended. Contact us for help.',
  PROFILE_REQUIRED: 'Your profile is still being set up. Log out, log in again and retry.',
  BUSY_TRY_AGAIN: 'Many orders at once. Please try again in a moment.',
  ORDER_NOT_FOUND: 'This order could not be found.',
  VERIFICATION_REQUIRED:
    'This service is for verified clients only. Contact our lawyer Gocha Okreshidze (https://t.me/ailawllc, info@ailaw.llc) to get verified.',
  FORBIDDEN: 'Only admins can do this.',
  NOT_A_DECLARATIONS_CLIENT:
    "Your account isn't linked to the 1% declarations service. Contact our lawyer Gocha Okreshidze (https://t.me/ailawllc, info@ailaw.llc).",
  VERIFICATION_PENDING: 'Your registration is waiting for verification by AI Law.',
  NO_INCOME_ENTRIES: 'Add at least one payment, or choose a month without income.',
  INVALID_DATE: 'Each payment needs a date in the month you are reporting.',
  INVALID_CURRENCY: 'Choose GEL, USD, EUR or GBP.',
  INVALID_AMOUNT: 'Enter amounts as numbers, like 1234 or 1234.56.',
  RATE_UNAVAILABLE: 'The exchange rate for that date is not available. Try again later.',
  ALREADY_CONFIRMED: 'This report is already saved.',
  DRAFT_EXPIRED: 'This report was for an earlier month. Report the current month instead.',
  DRAFT_NOT_FOUND: 'This report could not be found.',
  ALREADY_LINKED: 'This client already has a website account.',
  CANNOT_CHANGE_OWN_ACCOUNT: "You can't suspend your own account.",
  PRIVILEGED_ACCOUNT: 'Admin and staff accounts are changed directly in Firestore (Clients).',
  INVALID_PROFILE_DATA: 'Some details are too long or contain invalid characters.',
  RECENT_LOGIN_REQUIRED: 'For your security, confirm your login again and retry.',
  PRIVILEGED_ACCOUNT_DELETE_REQUIRES_REVIEW:
    'Staff and admin accounts can only be deleted by the AI Law team.',
  CLIENT_NOT_FOUND: 'This client could not be found.',
  CLIENT_HAS_NO_EMAIL: 'This client has no email address, which every order needs.',
  PASSPORT_OR_ID_REQUIRED: 'Enter the passport number or the ID number.',
  INVALID_EMAIL: 'Enter a valid email address.',
  MISSING_NAME: 'Enter the client’s first name.',
  ORDER_CLOSED: 'This order is completed or cancelled.',
  ORDER_HAS_NO_FOLDER: 'This order has no folder yet. Remake its agreement first.',
  LAWYER_NOT_AVAILABLE: 'This lawyer isn’t approved or active.',
  ALREADY_ASSIGNED: 'This lawyer is already on this order.',
  AGREEMENT_FAILED: 'The agreement could not be made. Try again.',
  EMAIL_FAILED: 'The email could not be sent. Try again later.',
  INVALID_FILE_TYPE: 'This type of file isn’t accepted here.',
  FILE_TOO_LARGE: 'The file is too large.',
  SAVE_THE_POST_FIRST: 'Save the post once before adding a cover.',
  INVALID_SLUG: 'Give the post a title.',
  ONLY_LEAD_DELIVERS: 'Only the lead lawyer delivers the result.',
  ALREADY_DELIVERED: 'This assignment is already delivered.',
  DOCUMENT_NOT_FOUND: 'This document could not be found.',
  INVALID_IBAN: 'Check the IBAN: it looks incomplete.',
  NOT_FOUND: 'This could not be found.',
};

// Closing the Google window is the person's choice, not an error
const SILENT = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];

export function authErrorMessage(error: unknown): string | null {
  const code = (error as { code?: string })?.code ?? (error as { message?: string })?.message ?? '';

  if (SILENT.includes(code)) return null;
  return MESSAGES[code] ?? 'Something went wrong. Please try again.';
}
