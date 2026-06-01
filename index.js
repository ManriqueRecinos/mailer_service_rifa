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

function parseFromAddress(fromStr) {
  if (!fromStr) return { email: '', name: '' };
  const match = fromStr.match(/^(?:"?([^"]*)"?\s)?(?:<([^>]+)>|([^\s@]+@[^\s@]+))$/);
  if (match) {
    const name = (match[1] || '').trim();
    const email = (match[2] || match[3] || '').trim();
    return { email, name };
  }
  return { email: fromStr.trim(), name: '' };
}

async function attemptSMTP(mailOptions, host, port, secure, maxRetries = 2) {
  let attempt = 0;
  while (true) {
    attempt++;
    const startTime = Date.now();
    console.log(`[SMTP] Intentando enviar correo en ${host}:${port} (intento ${attempt}/${maxRetries})...`);

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: !secure,
      connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT || '10000', 10),
      greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT || '10000', 10),
      socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT || '15000', 10),
      auth: {
        user: requireEnv('SMTP_USER'),
        pass: requireEnv('SMTP_PASS'),
      },
    });

    try {
      const result = await transporter.sendMail(mailOptions);
      const responseTime = Date.now() - startTime;
      console.log(`[SMTP] Correo enviado exitosamente en puerto ${port} (intento ${attempt}) en ${responseTime}ms. MessageId: ${result.messageId}`);
      return result;
    } catch (err) {
      const responseTime = Date.now() - startTime;
      console.error(`[SMTP] Error en puerto ${port} (intento ${attempt}) tras ${responseTime}ms:`, err.message || err);
      if (attempt >= maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function sendWithGmail(mailOptions) {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const maxRetries = parseInt(process.env.SMTP_MAX_RETRIES || '2', 10);

  try {
    return await attemptSMTP(mailOptions, host, 587, false, maxRetries);
  } catch (err587) {
    console.error(`[SMTP] Todos los intentos en el puerto 587 fallaron. Intentando fallback al puerto 465...`);
    try {
      return await attemptSMTP(mailOptions, host, 465, true, maxRetries);
    } catch (err465) {
      console.error(`[SMTP] Todos los intentos en el puerto 465 también fallaron.`);
      const combinedError = new Error(`SMTP Gmail falló en puertos 587 y 465. Último error: ${err465.message}`);
      combinedError.code = err465.code || 'SMTP_FAILURE';
      combinedError.errors = { port587: err587, port465: err465 };
      throw combinedError;
    }
  }
}

async function sendWithSendGrid(mailOptions) {
  const apiKey = requireEnv('SENDGRID_API_KEY');
  const fromAddress = parseFromAddress(mailOptions.from);

  const toList = (mailOptions.to || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((email) => ({ email }));

  const payload = {
    personalizations: [{ to: toList }],
    from: {
      email: fromAddress.email || process.env.SENDGRID_FROM || requireEnv('SMTP_USER'),
      name: fromAddress.name || undefined,
    },
    subject: mailOptions.subject,
    content: [
      {
        type: 'text/html',
        value: mailOptions.html,
      },
    ],
  };

  if (Array.isArray(mailOptions.attachments) && mailOptions.attachments.length > 0) {
    payload.attachments = mailOptions.attachments.map((att) => ({
      content: Buffer.isBuffer(att.content) ? att.content.toString('base64') : att.content,
      filename: att.filename,
      type: att.contentType,
      disposition: 'attachment',
    }));
  }

  const startTime = Date.now();
  console.log(`[SendGrid] Enviando correo a ${mailOptions.to}...`);

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseTime = Date.now() - startTime;

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const errorMsg = data && data.errors && data.errors[0]
      ? data.errors[0].message
      : `SendGrid error (${response.status})`;
    console.error(`[SendGrid] Error tras ${responseTime}ms: ${errorMsg}`);
    const e = new Error(errorMsg);
    e.statusCode = 502;
    throw e;
  }

  console.log(`[SendGrid] Correo enviado exitosamente tras ${responseTime}ms.`);
  return { messageId: response.headers.get('x-message-id') || 'sendgrid-ok' };
}

async function sendEmail(mailOptions) {
  const priorityStr = process.env.MAILER_PROVIDERS_PRIORITY || 'gmail,resend,sendgrid';
  const providers = priorityStr
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  const errors = [];

  for (const provider of providers) {
    try {
      if (provider === 'gmail' || provider === 'smtp') {
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
          throw new Error('Credenciales SMTP no configuradas');
        }
        return await sendWithGmail(mailOptions);
      } else if (provider === 'resend') {
        if (!process.env.RESEND_API_KEY) {
          throw new Error('RESEND_API_KEY no configurada');
        }
        return await sendWithResend(mailOptions);
      } else if (provider === 'sendgrid') {
        if (!process.env.SENDGRID_API_KEY) {
          throw new Error('SENDGRID_API_KEY no configurada');
        }
        return await sendWithSendGrid(mailOptions);
      } else {
        throw new Error(`Proveedor desconocido: ${provider}`);
      }
    } catch (err) {
      console.warn(`[Failover] Proveedor '${provider}' falló: ${err.message}`);
      errors.push({ provider, error: err.message });
    }
  }

  const errorMsg = `Todos los proveedores de correo fallaron. Registros: ${JSON.stringify(errors)}`;
  console.error(`[Mailer] Falló la cadena de envío de correos:`, errorMsg);
  const combinedError = new Error(errorMsg);
  combinedError.statusCode = 500;
  combinedError.details = errors;
  throw combinedError;
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
