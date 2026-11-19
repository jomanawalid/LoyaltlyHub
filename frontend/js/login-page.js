// Sign-in page logic (owner: Jomana).
import { signIn, completeNewPassword, currentUser } from './auth.js';
import { api } from './api.js';

const $ = (id) => document.getElementById(id);
const message = $('auth-message');
let pending = null; // { email, session } while Cognito waits for a new password

if (currentUser()) window.location.replace('app.html');

api('GET', '/api/health', { auth: false })
  .then((h) => { $('api-status').textContent = `API online: ${h.runtime}`; })
  .catch(() => { $('api-status').textContent = 'API not reachable (check js/env.js apiUrl).'; });

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  message.textContent = '';
  const email = $('email').value.trim().toLowerCase();
  const password = $('password').value;
  if (!$('email').checkValidity() || password.length < 10) {
    message.textContent = 'Enter a valid e-mail and a password of at least 10 characters.';
    return;
  }
  try {
    const res = await signIn(email, password);
    if (res.challenge) {
      pending = { email, session: res.session };
      $('login-form').hidden = true;
      $('new-password-form').hidden = false;
      $('new-password').focus();
      return;
    }
    window.location.replace('app.html');
  } catch (err) {
    message.textContent = err.message;
  } finally {
    $('password').value = '';
  }
});

$('new-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('new-password').value;
  const p2 = $('new-password-2').value;
  if (p1 !== p2) { message.textContent = 'The two passwords do not match.'; return; }
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/.test(p1)) {
    message.textContent = 'Use 10+ characters with upper case, lower case and a number.';
    return;
  }
  try {
    await completeNewPassword(pending.email, pending.session, p1);
    window.location.replace('app.html');
  } catch (err) {
    message.textContent = err.message;
  }
});
