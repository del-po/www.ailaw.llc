// ==========================================================
// Staff (lawyers for now)
//   - admin: the list of applications, approve, reject
//   - staff: who am I (the Workspace header), my assignments
// Applications come from the website's "Join as a lawyer" page through the
// Lawyers Apps Script, which writes the Lawyers sheet and the documents folder.
// Approving creates the lawyer's login here, because only Firebase Admin can.
// The function's service account must be an Editor of the Lawyers sheet.
// ==========================================================

import { getAuth } from 'firebase-admin/auth';
import { ApiError } from './ai.js';
import { readTab, updateRow } from './sheets.js';

const LAWYERS_SHEET_ID = '1hKh8Lu0Zo0TpuerTfS7uYw6Z3lG5CBxjEvSYzOKH0XM';
const TAB = 'Lawyers';
// Orders Database → Assignments: one row per lawyer per order
const ORDERS_SHEET_ID = '1bpWDaAs71FNpQpIAg2INx3cMb7rMI15tNLMJ_BQkdOQ';

const nowIso = () => new Date().toISOString();
const lawyers = () => readTab(LAWYERS_SHEET_ID, TAB);

async function findLawyer(lawyerId) {
  const row = (await lawyers()).rows.find((r) => r.LawyerID === lawyerId);
  if (!row) throw new ApiError('NOT_FOUND');
  return row;
}

// What the admin page shows. The documents folder opens in Drive, which
// only the owner of the folder can see.
function toAdminLawyer(r) {
  return {
    lawyerId: r.LawyerID,
    status: r.Status,
    firstName: r.FirstName,
    lastName: r.LastName,
    email: r.Email,
    phone: String(r.Phone || ''),
    barLicenseNumber: String(r.BarLicenseNumber || ''),
    licensedSince: String(r.LicensedSince || ''),
    specializations: r.Specializations,
    languages: r.Languages,
    bio: r.Bio,
    folderUrl: r.FolderID ? `https://drive.google.com/drive/folders/${r.FolderID}` : '',
    appliedAt: r.AppliedAt,
    verifiedAt: r.VerifiedAt,
    hasLogin: !!r.UserID,
  };
}

// ---------- Admin ----------

export async function adminLawyers() {
  return (await lawyers()).rows
    .filter((r) => r.LawyerID)
    .map(toAdminLawyer)
    .sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)));
}

// Creates (or reuses) the login for the application's email, marks it as
// staff and emails a link to set a password. Google sign-in with the same
// email reaches the same login.
export async function adminApproveLawyer(caller, data, env) {
  const row = await findLawyer(String(data.lawyerId || ''));
  if (row.Status !== 'applied') throw new ApiError('NOT_PENDING');

  const auth = getAuth();
  const email = String(row.Email).trim().toLowerCase();
  const name = `${row.FirstName} ${row.LastName}`.trim();

  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    // We checked who they are, and the invite goes to this address
    user = await auth.createUser({ email, displayName: name, emailVerified: true });
  }
  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    staff: true,
    lawyerId: row.LawyerID,
  });

  const link = await auth.generatePasswordResetLink(email, { url: `${env.origin}/login` });

  await updateRow(LAWYERS_SHEET_ID, TAB, row._row, {
    UserID: user.uid,
    Status: 'approved',
    VerifiedAt: nowIso(),
    UpdatedAt: nowIso(),
  });

  await env.sendMail({
    to: email,
    subject: 'Welcome to AI Law — set up your Workspace login',
    body: [
      `Dear ${row.FirstName},`,
      '',
      'Your application to work with AI Law has been approved. Welcome to the team.',
      '',
      'Set your password with this link:',
      link,
      '',
      `Then log in at ${env.origin}/login with ${email}. You can also use "Continue with Google" with this same email address.`,
      'After logging in you will land in your Workspace, where your assignments appear.',
      '',
      `Your lawyer code: ${row.LawyerID}`,
      '',
      'AI Law LLC · www.ailaw.llc',
    ].join('\n'),
  });

  return adminLawyers();
}

export async function adminRejectLawyer(caller, data, env) {
  const row = await findLawyer(String(data.lawyerId || ''));
  if (row.Status !== 'applied') throw new ApiError('NOT_PENDING');

  await updateRow(LAWYERS_SHEET_ID, TAB, row._row, {
    Status: 'left',
    UpdatedAt: nowIso(),
    Notes: [row.Notes, `Not approved ${nowIso().slice(0, 10)}`].filter(Boolean).join(' · '),
  });

  await env.sendMail({
    to: row.Email,
    subject: 'Your application to AI Law',
    body: [
      `Dear ${row.FirstName},`,
      '',
      'Thank you for your interest in working with AI Law and for the time you put into your application.',
      '',
      'After reviewing it, we are not able to offer you a place at this time. We will keep your details and may contact you if a suitable opportunity comes up.',
      '',
      'AI Law LLC · www.ailaw.llc',
    ].join('\n'),
  });

  return adminLawyers();
}

// ---------- Staff ----------

// The signed-in lawyer. The first visit turns "approved" into "active".
export async function staffMe(caller) {
  const row = (await lawyers()).rows.find(
    (r) => r.UserID === caller.uid && r.LawyerID === caller.lawyerId,
  );
  if (!row || ['suspended', 'left'].includes(row.Status)) throw new ApiError('FORBIDDEN');

  if (row.Status === 'approved') {
    await updateRow(LAWYERS_SHEET_ID, TAB, row._row, { Status: 'active', UpdatedAt: nowIso() });
    row.Status = 'active';
  }

  return {
    lawyerId: row.LawyerID,
    firstName: row.FirstName,
    lastName: row.LastName,
    email: row.Email,
    status: row.Status,
  };
}

// The signed-in lawyer's assignments, newest first. Cancelled ones are left
// out; a lawyer never sees anyone else's.
export async function staffAssignments(caller) {
  const [assignments, orders] = await Promise.all([
    readTab(ORDERS_SHEET_ID, 'Assignments'),
    readTab(ORDERS_SHEET_ID, 'Orders'),
  ]);
  return assignments.rows
    .filter((a) => a.LawyerID === caller.lawyerId && a.AssignmentID && a.Status !== 'cancelled')
    .map((a) => {
      const order = orders.rows.find((o) => o.OrderNumber === a.OrderNumber) || {};
      return {
        assignmentId: a.AssignmentID,
        orderNumber: a.OrderNumber,
        service: a.Service || order.Service || '',
        client: a.Client || order.CustomerName || '',
        role: a.Role || 'lead',
        status: a.Status || 'assigned',
        tasks: String(a.Tasks || ''),
        fee: a.Fee === '' ? null : Number(a.Fee),
        currency: order.Currency || 'GEL',
        assignedAt: a.AssignedAt,
        completedAt: a.CompletedAt,
        orderStatus: order.OrderStatus || '',
        paymentStatus: order.PaymentStatus || '',
      };
    })
    .sort((x, y) => String(y.assignedAt).localeCompare(String(x.assignedAt)));
}
