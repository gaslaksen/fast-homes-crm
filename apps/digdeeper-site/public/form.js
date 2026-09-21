/*
 * The call-back request form. Posts JSON to /api/inquiry, which vercel.json
 * rewrites to the Dealcore API, so the browser never makes a cross-origin
 * request. The API stores the inquiry with the consent record and emails the
 * team. No analytics, no third-party scripts.
 *
 * CONSENT_VERSION must match DIGDEEPER_CONSENT_VERSION in
 * apps/api/src/web-inquiries/web-inquiries.constants.ts. The API records the
 * consent wording it holds for that version, so change the wording in
 * index.html and in that file together, and bump both versions.
 */
(function () {
  var CONSENT_VERSION = '2026-09-21';
  var form = document.getElementById('inquiry-form');
  if (!form) return;
  var status = document.getElementById('form-status');
  var button = form.querySelector('button[type="submit"]');

  function say(text, kind) {
    status.textContent = text;
    status.className = 'form-status' + (kind ? ' is-' + kind : '');
  }

  function value(name) {
    var el = form.elements[name];
    return el && typeof el.value === 'string' ? el.value.trim() : '';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var fullName = value('fullName');
    var phone = value('phone');
    var email = value('email');
    var marketing = form.elements.smsMarketingConsent.checked;
    var service = form.elements.smsServiceConsent.checked;
    var digits = phone.replace(/\D/g, '');

    if (fullName.length < 2) {
      say('Please enter your full name.', 'error');
      form.elements.fullName.focus();
      return;
    }
    if (!phone && !email) {
      say('Please enter a phone number or an email address so we can reach you.', 'error');
      form.elements.phone.focus();
      return;
    }
    if (phone && (digits.length < 10 || digits.length > 11)) {
      say('Please enter a 10 digit phone number.', 'error');
      form.elements.phone.focus();
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      say('Please check the email address.', 'error');
      form.elements.email.focus();
      return;
    }
    if ((marketing || service) && !phone) {
      say('To receive text messages, please enter the phone number to text.', 'error');
      form.elements.phone.focus();
      return;
    }

    var payload = {
      fullName: fullName,
      smsMarketingConsent: marketing,
      smsServiceConsent: service,
      consentVersion: CONSENT_VERSION,
      pageUrl: window.location.href.slice(0, 300),
    };
    if (phone) payload.phone = phone;
    if (email) payload.email = email;
    if (value('city')) payload.city = value('city');
    if (value('state')) payload.state = value('state');
    if (value('message')) payload.message = value('message');
    if (value('website')) payload.website = value('website');

    button.disabled = true;
    say('Sending...', '');

    fetch(form.getAttribute('action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (res.ok) return null;
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            var message = Array.isArray(body.message) ? body.message[0] : body.message;
            throw new Error(res.status === 429 ? 'rate' : message || 'failed');
          });
      })
      .then(function () {
        form.reset();
        say('Thank you. We have your request and will be in touch within one business day.', 'ok');
      })
      .catch(function (err) {
        say(
          err && err.message === 'rate'
            ? 'Too many requests from this connection. Please call us on (904) 595-9620.'
            : 'We could not send your request. Please call us on (904) 595-9620 or email deals@digdeeperllc.com.',
          'error',
        );
      })
      .then(function () {
        button.disabled = false;
      });
  });
})();
