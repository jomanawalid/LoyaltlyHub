// One fetch wrapper for every service (owner: Habiba).
// Sends the Cognito token, turns API error codes into friendly messages, and sends
// the user back to sign-in on 401. The API only returns generic messages, so the
// friendly text for each code lives here.
import { config } from './config.js';
import { getToken, signOut } from './auth.js';

const FRIENDLY = {
  VALIDATION_ERROR: 'Please check the form: some values are missing or not valid.',
  UNAUTHORIZED: 'Your session has ended. Please sign in again.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'Not found.',
  EMAIL_TAKEN: 'This e-mail is already registered in this business.',
  CUSTOMER_NOT_ACTIVE: 'This customer is not active.',
  CUSTOMER_ERASED: 'This customer was erased.',
  INVALID_STATUS_TRANSITION: 'That status change is not allowed.',
  OPEN_VOUCHERS: 'The customer still has vouchers that were not handed over.',
  INSUFFICIENT_POINTS: 'Not enough points.',
  OUT_OF_STOCK: 'Sorry, this reward is out of stock.',
  REWARD_RETIRED: 'This reward is no longer available.',
  REDEMPTION_LIMIT_REACHED: 'Monthly limit for this reward reached.',
  DAILY_CAP_REACHED: 'Daily points limit for this customer reached.',
  POINTS_ALREADY_SPENT: 'These points were already spent, so the transaction cannot be voided.',
  ALREADY_VOIDED: 'This transaction was already voided.',
  NOT_VOIDABLE: 'Only purchases and manual adjustments can be voided.',
  VOUCHER_MISMATCH: 'The voucher code does not match (or it was already used).',
  REQUEST_IN_PROGRESS: 'This request is already being processed.',
  IDEMPOTENCY_KEY_REUSED: 'Please try again.',
  REWARD_NAME_TAKEN: 'A reward with this name already exists.',
  DUPLICATE: 'This already exists.',
  PAYLOAD_TOO_LARGE: 'Too much data in the form.',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported request.',
  UPSTREAM_ERROR: 'A part of the system is not responding. Please try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
};

export class ApiError extends Error {
  constructor(status, code, requestId) {
    super(FRIENDLY[code] || 'Request failed.');
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export async function api(method, path, { body, headers = {}, auth = true } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (auth) {
    const token = getToken();
    if (!token) {
      window.location.replace('index.html');
      throw new ApiError(401, 'UNAUTHORIZED');
    }
    h.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) h['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${config.apiUrl}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'UPSTREAM_ERROR');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data && data.error) || {};
    if (res.status === 401 && auth) {
      signOut();
      window.location.replace('index.html');
    }
    throw new ApiError(res.status, err.code || 'INTERNAL_ERROR', err.requestId);
  }
  return data;
}

/** Build a query string, skipping empty values. */
export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}
