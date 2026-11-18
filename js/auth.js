// Sign-in page for couples and the admin.
import { backend, mode } from './backend.js';
import { boot, h, icon, brand, run, field, input, vals, site } from './ui.js';
import { APP } from './app-config.js';

const app = boot('Sign in');
const home = (role) => site(role === 'admin' ? 'admin.html' : 'dashboard.html');

async function start() {
  const s = await backend.session();
  if (s) return location.replace(home(s.role));
  const form = h('form', { class: 'form' },
    field('Mobile number', input({ name: 'mobile', inputmode: 'numeric', autocomplete: 'username', maxlength: 14, placeholder: '10-digit mobile number' })),
    field('Password', input({ name: 'password', type: 'password', autocomplete: 'current-password' })),
    h('button', { class: 'btn primary block', type: 'submit' }, icon('lock'), 'Sign in'),
    h('p', { class: 'small muted center' }, 'Accounts are created by the administrator. Forgot your password? Ask them for a new login.'),
    mode === 'preview' && h('div', { class: 'note info' }, h('b', {}, 'Preview logins'), h('div', {}, 'Couple: 9876543210 / demo1234'), h('div', {}, 'Admin: 9000000000 / admin1234')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = vals(form);
    const who = await run(form.querySelector('button[type=submit]'), () => backend.login(v.mobile, v.password));
    if (who) location.replace(home(who.role));
  });
  return app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card col' }, brand(), h('div', {}, h('h1', { style: 'font-size:28px' }, 'Welcome back'), h('p', { class: 'muted' }, APP.tagline)), form)));
}
start();
