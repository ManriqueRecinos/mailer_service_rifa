require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

app.use(cors());
app.use(express.json({ limit: process.env.MAILER_BODY_LIMIT || '20mb' }));

async function sendWithResend(mailOptions) {
  const apiKey = requireEnv('RESEND_API_KEY');

  const payload = {
    from: mailOptions.from,
    to: (mailOptions.to || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    subject: mailOptions.subject,
    html: mailOptions.html,
  };

  if (Array.isArray(mailOptions.attachments) && mailOptions.attachments.length > 0) {
    payload.attachments = mailOptions.attachments.map((att) => ({
      filename: att.filename,
      content: Buffer.isBuffer(att.content) ? att.content.toString('base64') : att.content,
      content_type: att.contentType,
    }));
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = data && (data.message || data.error)
      ? (data.message || data.error)
      : `Resend error (${response.status})`;
    const e = new Error(msg);
    e.statusCode = 502;
    throw e;
  }

  return { messageId: data.id || data?.data?.id };
}

function parseBool(value) {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return undefined;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v || (typeof v === 'string' && v.trim() === '')) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

let cachedTransporter;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secureFromEnv = parseBool(process.env.SMTP_SECURE);
  const secure = typeof secureFromEnv === 'boolean' ? secureFromEnv : port === 465;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT || '15000', 10),
    greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT || '15000', 10),
    socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT || '20000', 10),
    auth: {
      user: requireEnv('SMTP_USER'),
      pass: requireEnv('SMTP_PASS'),
    },
  });

  return cachedTransporter;
}

async function sendEmail(mailOptions) {
  const transport = (process.env.MAILER_TRANSPORT || 'smtp').trim().toLowerCase();
  if (transport === 'resend') {
    return sendWithResend(mailOptions);
  }

  const transporter = getTransporter();
  return transporter.sendMail(mailOptions);
}

function authMiddleware(req, res, next) {
  const expected = process.env.MAILER_API_KEY;
  if (!expected) {
    return res.status(500).json({ error: 'MAILER_API_KEY not configured on mailer service' });
  }

  const provided = req.header('x-api-key');
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}

app.get('/', (_req, res) => {
  res.json({
    name: 'rifas-mailer',
    status: 'ok',
    endpoints: {
      health: 'GET /health',
      send: 'POST /send',
    },
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.post('/send', authMiddleware, async (req, res) => {
  try {
    const { to, subject, html, from, attachments } = req.body || {};

    if (!to || !subject || !html) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
    }

    const normalizedTo = Array.isArray(to) ? to : [to];
    const toList = normalizedTo
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);

    if (toList.length === 0) {
      return res.status(400).json({ error: 'Invalid "to"' });
    }

    const resolvedFrom =
      from ||
      process.env.MAILER_FROM ||
      process.env.SMTP_FROM ||
      (process.env.SMTP_USER ? `"Rifas Premium" <${process.env.SMTP_USER}>` : undefined);

    if (!resolvedFrom) {
      return res.status(500).json({
        error: 'Missing "from". Provide "from" in request or set MAILER_FROM / SMTP_FROM (or SMTP_USER for default).',
      });
    }

    const maxAttachmentBytes = parseInt(process.env.MAILER_MAX_ATTACHMENT_BYTES || '0', 10);
    let attachmentBytes = 0;

    const mailOptions = {
      from: resolvedFrom,
      to: toList.join(', '),
      subject,
      html,
    };

    if (Array.isArray(attachments) && attachments.length > 0) {
      mailOptions.attachments = attachments.map((att) => {
        if (!att || !att.filename || !att.contentBase64) {
          throw new Error('Invalid attachment: expected filename and contentBase64');
        }

        if (typeof att.contentBase64 !== 'string') {
          throw new Error('Invalid attachment: contentBase64 must be a string');
        }

        const contentBuffer = Buffer.from(att.contentBase64, 'base64');
        attachmentBytes += contentBuffer.length;
        if (maxAttachmentBytes > 0 && attachmentBytes > maxAttachmentBytes) {
          const e = new Error('Attachments too large');
          e.statusCode = 413;
          throw e;
        }

        return {
          filename: att.filename,
          content: contentBuffer,
          contentType: att.contentType || 'application/octet-stream',
        };
      });
    }

    const result = await sendEmail(mailOptions);

    return res.status(200).json({ success: true, messageId: result.messageId });
  } catch (err) {
    if (
      err &&
      (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') &&
      err.command === 'CONN'
    ) {
      err.message = `${err.message} (SMTP connection failed. On Render free tier, outbound SMTP ports 25/465/587 are blocked. Use a paid instance or set MAILER_TRANSPORT=resend.)`;
    }
    console.error('[Mailer] Error:', err);
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    return res.status(status).json({ error: err.message || 'Mailer error' });
  }
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Mailer] listening on 0.0.0.0:${PORT}`);
});
